package com.luminculler.app.cleaner.grow

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import com.luminculler.app.cleaner.core.Mood
import com.luminculler.app.cleaner.core.Music
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Pune muzică pe un clip deja făcut: compune muzica exact cât ține clipul
 * (vezi core/Music), o codează AAC și scrie un MP4 nou cu imaginea neatinsă
 * plus sunetul. La orice eroare întoarce clipul inițial, fără sunet: un film
 * mut e mai bun decât niciun film.
 */
object Soundtrack {
    private const val MIME = MediaFormat.MIMETYPE_AUDIO_AAC

    private class Frame(val data: ByteArray, val pts: Long, val flags: Int)

    suspend fun addMusic(video: File, mood: Mood, seed: Long): File = withContext(Dispatchers.Default) {
        try {
            mux(video, mood, seed)
        } catch (e: Throwable) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            video
        }
    }

    private fun mux(video: File, mood: Mood, seed: Long): File {
        val ex = MediaExtractor()
        ex.setDataSource(video.absolutePath)
        try {
            val vIdx = (0 until ex.trackCount).first { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true }
            val vFormat = ex.getTrackFormat(vIdx)
            ex.selectTrack(vIdx)
            val durationUs = if (vFormat.containsKey(MediaFormat.KEY_DURATION)) vFormat.getLong(MediaFormat.KEY_DURATION) else lastSampleTime(video)
            val seconds = (durationUs / 1_000_000f).coerceAtLeast(1f)

            val (aFormat, frames) = encode(Music.render(mood, seconds, seed))

            val out = File(video.parentFile, video.nameWithoutExtension + "-music.mp4")
            out.delete()
            val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            try {
                val vTrack = muxer.addTrack(vFormat)
                val aTrack = muxer.addTrack(aFormat)
                muxer.start()
                val size = if (vFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) vFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE) else 4 shl 20
                val buf = ByteBuffer.allocate(maxOf(size, 1 shl 20))
                val info = MediaCodec.BufferInfo()
                while (true) {
                    buf.clear()
                    val n = ex.readSampleData(buf, 0)
                    if (n < 0) break
                    info.set(0, n, ex.sampleTime, if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                    muxer.writeSampleData(vTrack, buf, info)
                    ex.advance()
                }
                for (f in frames) {
                    if (f.pts > durationUs) break
                    info.set(0, f.data.size, f.pts, f.flags)
                    muxer.writeSampleData(aTrack, ByteBuffer.wrap(f.data), info)
                }
                muxer.stop()
            } finally {
                muxer.release()
            }
            video.delete()
            return out
        } finally {
            ex.release()
        }
    }

    private fun lastSampleTime(video: File): Long {
        val ex = MediaExtractor()
        ex.setDataSource(video.absolutePath)
        try {
            ex.selectTrack(0)
            var last = 0L
            while (ex.sampleTime >= 0) { last = ex.sampleTime; ex.advance() }
            return last
        } finally {
            ex.release()
        }
    }

    /** PCM stereo 16 biți → cadre AAC, cu formatul de ieșire al codorului. */
    private fun encode(pcm: ShortArray): Pair<MediaFormat, List<Frame>> {
        val format = MediaFormat.createAudioFormat(MIME, Music.SAMPLE_RATE, 2).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 160_000)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384)
        }
        val enc = MediaCodec.createEncoderByType(MIME)
        enc.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        enc.start()
        val info = MediaCodec.BufferInfo()
        val frames = ArrayList<Frame>()
        var outFormat: MediaFormat? = null
        var pos = 0
        var inputDone = false
        try {
            while (true) {
                if (!inputDone) {
                    val i = enc.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val b = enc.getInputBuffer(i)!!
                        b.clear()
                        val count = minOf(b.remaining() / 2, pcm.size - pos) and 1.inv() // întotdeauna perechi stânga-dreapta
                        val pts = (pos / 2).toLong() * 1_000_000L / Music.SAMPLE_RATE
                        if (count <= 0) {
                            enc.queueInputBuffer(i, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            b.order(ByteOrder.nativeOrder()).asShortBuffer().put(pcm, pos, count)
                            enc.queueInputBuffer(i, 0, count * 2, pts, 0)
                            pos += count
                        }
                    }
                }
                val o = enc.dequeueOutputBuffer(info, 10_000)
                when {
                    o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> outFormat = enc.outputFormat
                    o >= 0 -> {
                        val ob = enc.getOutputBuffer(o)
                        if (ob != null && info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
                            ob.position(info.offset)
                            ob.limit(info.offset + info.size)
                            val data = ByteArray(info.size).also { ob.get(it) }
                            frames.add(Frame(data, info.presentationTimeUs, 0))
                        }
                        val end = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                        enc.releaseOutputBuffer(o, false)
                        if (end) break
                    }
                }
            }
        } finally {
            try { enc.stop() } catch (_: Throwable) { }
            enc.release()
        }
        return (outFormat ?: throw IllegalStateException("no audio format")) to frames
    }
}
