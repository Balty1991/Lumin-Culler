package com.luminculler.app.cleaner

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import com.luminculler.app.cleaner.core.Mood
import com.luminculler.app.cleaner.core.Music
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Muzica de sub o poveste, compusă pe loc (core/Music) și cântată în timp ce
 * omul privește. Se oprește când iese din poveste; volumul pornește încet.
 */
class StoryMusic(private val scope: CoroutineScope) {
    private var job: Job? = null
    private var track: AudioTrack? = null

    fun play(mood: Mood, seconds: Float, seed: Long) {
        stop()
        job = scope.launch(Dispatchers.Default) {
            val pcm = Music.render(mood, seconds, seed)
            if (!isActive) return@launch
            val min = AudioTrack.getMinBufferSize(Music.SAMPLE_RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT)
            val t = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAudioFormat(AudioFormat.Builder().setSampleRate(Music.SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                .setBufferSizeInBytes(maxOf(min, 64 * 1024))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            track = t
            try {
                t.play()
                var pos = 0
                val chunk = 8192
                while (isActive && pos < pcm.size) {
                    val n = minOf(chunk, pcm.size - pos)
                    val wrote = t.write(pcm, pos, n)
                    if (wrote <= 0) break
                    pos += wrote
                }
            } catch (_: Throwable) {
                // Fără sunet nu e o eroare de arătat: povestea merge mai departe.
            } finally {
                try { t.stop() } catch (_: Throwable) { }
                t.release()
                if (track === t) track = null
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
        try { track?.pause(); track?.flush() } catch (_: Throwable) { }
    }
}
