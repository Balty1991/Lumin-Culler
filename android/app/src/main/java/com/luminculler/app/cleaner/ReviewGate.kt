package com.luminculler.app.cleaner

/** Ask once, after a real clean, not after the first accidental tap. */
fun shouldAskForReview(previousDeletes: Int, added: Int, alreadyAsked: Boolean): Boolean {
    if (alreadyAsked || added <= 0) return false
    val next = previousDeletes + added
    return previousDeletes < 3 && next >= 3
}
