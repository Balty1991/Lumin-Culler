package com.luminculler.app.cleaner

/**
 * What the cleaner is allowed to see. Android 14 can grant a partial
 * selection (READ_MEDIA_VISUAL_USER_SELECTED) without READ_MEDIA_IMAGES.
 * Treating that as "denied" hides a gallery the person just shared.
 */
enum class PhotoAccess { Full, Limited, Denied }

fun photoAccess(sdk: Int, images: Boolean, legacyStorage: Boolean, partial: Boolean): PhotoAccess {
    if (sdk >= 34) {
        if (images) return PhotoAccess.Full
        if (partial) return PhotoAccess.Limited
        return PhotoAccess.Denied
    }
    if (sdk >= 33) return if (images) PhotoAccess.Full else PhotoAccess.Denied
    return if (legacyStorage) PhotoAccess.Full else PhotoAccess.Denied
}

/** Videos are a separate grant from Android 13. Partial photo access includes the videos the person picked. */
fun videosReadable(sdk: Int, videos: Boolean, photos: PhotoAccess): Boolean {
    if (sdk >= 34 && photos == PhotoAccess.Limited) return true
    if (sdk >= 33) return videos
    return photos != PhotoAccess.Denied
}

/**
 * Largest subset [accepts] will take.
 *
 * MediaStore throws away the whole batch when one uri is bad, and it also
 * rejects a batch that is simply too big. Halving finds a batch that already
 * succeeded, which is the one the screen then launches.
 */
fun <T> acceptedBatch(items: List<T>, accepts: (List<T>) -> Boolean): List<T> {
    if (items.isEmpty()) return emptyList()
    if (accepts(items)) return items.toList()
    if (items.size == 1) return emptyList()
    val mid = items.size / 2
    val left = acceptedBatch(items.subList(0, mid), accepts)
    val right = acceptedBatch(items.subList(mid, items.size), accepts)
    if (left.isEmpty()) return right
    if (right.isEmpty()) return left
    val together = left + right
    if (together.size < items.size && accepts(together)) return together
    return if (left.size >= right.size) left else right
}
