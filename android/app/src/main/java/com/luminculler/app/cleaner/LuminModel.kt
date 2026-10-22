package com.luminculler.app.cleaner

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.luminculler.app.cleaner.core.Basket
import com.luminculler.app.cleaner.core.DailyStack
import com.luminculler.app.cleaner.core.Grouping
import com.luminculler.app.cleaner.core.Kind
import com.luminculler.app.cleaner.core.Media
import com.luminculler.app.cleaner.core.Plan
import com.luminculler.app.cleaner.core.Signals
import com.luminculler.app.cleaner.core.StackItem
import com.luminculler.app.cleaner.core.Streak
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId

sealed interface Route {
    data object Onboarding : Route
    /** Ecranul principal: momentele, oamenii, filmele. */
    data object Moments : Route
    /** Povestea unui moment, pe tot ecranul. */
    data class Story(val moment: com.luminculler.app.cleaner.core.Moment) : Route
    /** Filmul unui moment: șablon, format, titlu, montaj. */
    data class Movie(val moment: com.luminculler.app.cleaner.core.Moment) : Route
    /** Fila „Curăță”: teancul zilnic și coșurile. */
    data object Today : Route
    data object Deck : Route
    data class BasketView(val kind: Kind) : Route
    /** Confirmarea ștergerii: ce a marcat omul în teanc, sau ce a ales dintr-un coș. */
    data class Review(val items: List<Media>, val fromBasket: Kind?) : Route
    data class Done(val bytes: Long, val count: Int) : Route
    data class Paywall(val reason: PaywallReason) : Route
    data object Settings : Route
    data object Grow : Route
    /** „Magie AI” pe o poză; înapoi se întoarce de unde a venit. */
    data class Magic(val media: Media, val from: Route) : Route
}

enum class PaywallReason { ExtraStack, BulkClean, Browse }

data class ScanProgress(val done: Int, val total: Int) {
    val running: Boolean get() = total > 0 && done < total
}

/**
 * Starea aplicației și tot ce schimbă starea. Ecranele doar o citesc și cheamă
 * funcțiile de aici; ștergerea propriu-zisă și plata au nevoie de Activity,
 * pe care o primesc prin [LuminHost].
 */
class LuminModel(val context: Context, private val scope: CoroutineScope, private val host: LuminHost) {
    val store = Store(context)
    private val library = Library(context)
    val trash = Trash(context)
    val billing = PlayBilling(context) { bought -> onPurchaseResult(bought) }
    val grow = com.luminculler.app.cleaner.grow.GrowModel(context, scope).also { g -> g.onPeople = { refreshMoments() } }
    val movie = com.luminculler.app.cleaner.grow.MovieModel(context, scope)
    val magic = com.luminculler.app.cleaner.magic.MagicModel(context, scope)
    private val zone: ZoneId = ZoneId.systemDefault()

    var route by mutableStateOf<Route>(if (store.onboarded && galleryAccess(context) != Access.None) Route.Moments else Route.Onboarding)
    var access by mutableStateOf(galleryAccess(context))
    var loading by mutableStateOf(true)
    var photos by mutableStateOf<List<Media>>(emptyList())
    var videos by mutableStateOf<List<Media>>(emptyList())
    var baskets by mutableStateOf<Map<Kind, Basket>>(emptyMap())
    var scan by mutableStateOf(ScanProgress(0, 0))
    var stack by mutableStateOf<List<StackItem>>(emptyList())
    var position by mutableIntStateOf(0)
    var marked by mutableStateOf<List<Media>>(emptyList())
    var freedBytes by mutableStateOf(store.freedBytes)
    var freedCount by mutableIntStateOf(store.freedCount)
    var streak by mutableIntStateOf(Streak.current(store.completedDays, today()))
    var premium by mutableStateOf(billing.premium)
    var locked by mutableStateOf(billing.locked)
    var plans by mutableStateOf<List<PlanOffer>>(emptyList())
    var plansLoaded by mutableStateOf(false)
    var message by mutableStateOf<String?>(null)
    var dailyReminder by mutableStateOf(store.dailyReminder)
    var moments by mutableStateOf<List<com.luminculler.app.cleaner.core.Moment>>(emptyList())
    private var momentsJob: Job? = null

    private var signals: Map<Long, Signals> = emptyMap()
    private var scanJob: Job? = null
    private var stackIdsAtStart: Set<Long> = emptySet()

    val todayDone: Boolean get() = today().toString() in store.completedDays
    val reclaimableBytes: Long get() = baskets.values.sumOf { it.bytes }
    val canStartAnotherStack: Boolean get() = Plan.canStartAnotherStack(!locked, store.stacksToday)

    fun today(): LocalDate = LocalDate.now(zone)

    fun start() {
        scope.launch { refreshBilling() }
        if (access != Access.None) load()
    }

    fun onPermissionsResult() {
        access = galleryAccess(context)
        if (access != Access.None) {
            store.onboarded = true
            route = Route.Moments
            load()
        }
    }

    /** La revenirea în aplicație: poate s-au șters/adăugat poze din Galerie între timp. */
    fun onResume() {
        val now = galleryAccess(context)
        val changed = now != access
        access = now
        if (now != Access.None && (changed || scanJob == null)) load()
    }

    fun load() {
        scanJob?.cancel()
        scanJob = scope.launch {
            loading = true
            val snap = withContext(Dispatchers.IO) { library.snapshot() }
            photos = snap.photos
            videos = snap.videos
            signals = withContext(Dispatchers.IO) { library.cachedSignals(snap.photos) }
            regroup()
            ensureStack()
            loading = false
            refreshMoments()
            grow.ensureScan(photos)
            var lastGroup = System.currentTimeMillis()
            library.computeMissing(snap.photos) { done, total, partial ->
                scope.launch {
                    scan = ScanProgress(done, total)
                    val now = System.currentTimeMillis()
                    if (done == total || now - lastGroup > 2500) {
                        lastGroup = now
                        signals = partial
                        regroup()
                        if (done == total) refreshMoments()
                    }
                }
            }
        }
    }

    private suspend fun regroup() {
        val p = photos
        val v = videos
        val s = signals
        val kept = HashSet(store.kept)
        baskets = withContext(Dispatchers.Default) { Grouping.build(p, s, v, kept) }
    }

    /** Teancul de azi: refolosit dacă există, altfel construit o singură dată pe zi. */
    private suspend fun ensureStack() {
        val day = DailyStack.dayKey(today())
        if (store.stackDay != day) {
            store.stackDay = day
            store.stacksToday = 0
            store.stackIds = emptyList()
            store.stackPosition = 0
        }
        val byId = photos.associateBy { it.id }
        val savedIds = store.stackIds
        if (savedIds.isNotEmpty()) {
            val suggested = suggestionKinds()
            stack = savedIds.mapNotNull { id -> byId[id]?.let { restoreItem(it, suggested) } }
            // Pozele deja șterse lipsesc din listă: poziția se numără doar pe cele rămase.
            position = savedIds.take(store.stackPosition).count { it in byId }.coerceIn(0, stack.size)
            val pending = store.pendingDelete.toSet()
            marked = stack.map { it.media }.filter { it.id in pending }
        } else {
            buildStack(exclude = emptySet())
        }
        stackIdsAtStart = stack.map { it.media.id }.toSet()
    }

    private fun suggestionKinds(): Map<Long, Kind> {
        val out = HashMap<Long, Kind>()
        for ((k, b) in baskets) if (k != Kind.Videos) b.extras.forEach { out.putIfAbsent(it.id, k) }
        return out
    }

    private fun restoreItem(m: Media, suggested: Map<Long, Kind>): StackItem {
        val kind = suggested[m.id]
        if (kind != null) return StackItem(m, com.luminculler.app.cleaner.core.Reason.Suggested, kind = kind)
        val date = java.time.Instant.ofEpochMilli(m.taken).atZone(zone).toLocalDate()
        val t = today()
        return if (date.year < t.year && date.monthValue == t.monthValue && date.dayOfMonth == t.dayOfMonth) {
            StackItem(m, com.luminculler.app.cleaner.core.Reason.Memory, yearsAgo = t.year - date.year)
        } else {
            StackItem(m, com.luminculler.app.cleaner.core.Reason.Recent)
        }
    }

    private suspend fun buildStack(exclude: Set<Long>) {
        val p = photos
        val b = baskets
        val reviewed = HashSet(store.kept)
        val t = today()
        stack = withContext(Dispatchers.Default) { DailyStack.build(t, zone, p, b, reviewed, DailyStack.FREE_SIZE, exclude) }
        position = 0
        marked = emptyList()
        store.stackIds = stack.map { it.media.id }
        store.stackPosition = 0
        store.pendingDelete = emptyList()
    }

    fun openDeck() {
        if (stack.isEmpty() || position >= stack.size) return
        if (store.stacksToday == 0) store.stacksToday = 1
        val pending = store.pendingDelete.toSet()
        if (marked.isEmpty() && pending.isNotEmpty()) marked = stack.map { it.media }.filter { it.id in pending }
        route = Route.Deck
    }

    fun anotherStack() {
        if (!canStartAnotherStack) {
            route = Route.Paywall(PaywallReason.ExtraStack)
            return
        }
        scope.launch {
            store.stacksToday = store.stacksToday + 1
            buildStack(exclude = stackIdsAtStart + stack.map { it.media.id })
            stackIdsAtStart = stackIdsAtStart + stack.map { it.media.id }
            if (stack.isNotEmpty()) route = Route.Deck
        }
    }

    fun swipe(keep: Boolean) {
        val item = stack.getOrNull(position) ?: return
        if (keep) store.keep(listOf(item.media.id)) else marked = marked + item.media
        position += 1
        store.stackPosition = position
        store.pendingDelete = marked.map { it.id }
        if (position >= stack.size) finishStack()
    }

    fun undo() {
        if (position == 0) return
        position -= 1
        val item = stack[position]
        if (marked.any { it.id == item.media.id }) marked = marked.filter { it.id != item.media.id } else store.unkeep(item.media.id)
        store.stackPosition = position
        store.pendingDelete = marked.map { it.id }
    }

    fun finishStack() {
        if (marked.isNotEmpty()) {
            route = Route.Review(marked, null)
        } else {
            completeDay()
            route = Route.Done(0, 0)
        }
    }

    private fun completeDay() {
        store.completedDays = store.completedDays + today().toString()
        streak = Streak.current(store.completedDays, today())
    }

    fun openBasket(kind: Kind) {
        route = Route.BasketView(kind)
    }

    /** Ștergerea dintr-un coș: prima e gratuită, apoi Premium. */
    fun cleanFromBasket(kind: Kind, selected: List<Media>, notSelected: List<Media>) {
        if (selected.isEmpty()) return
        if (!Plan.canBulkClean(!locked, store.freeBulkUsed)) {
            route = Route.Paywall(PaywallReason.BulkClean)
            return
        }
        store.keep(notSelected.map { it.id })
        route = Route.Review(selected, kind)
    }

    fun unmark(media: Media) {
        val r = route as? Route.Review ?: return
        val left = r.items.filter { it.id != media.id }
        if (r.fromBasket == null) {
            marked = left
            store.pendingDelete = left.map { it.id }
            store.keep(listOf(media.id))
        }
        route = r.copy(items = left)
    }

    /** Omul s-a răzgândit la final: nimic nu se șterge, teancul e totuși gata. */
    fun keepAllMarked() {
        store.keep(marked.map { it.id })
        marked = emptyList()
        store.pendingDelete = emptyList()
        completeDay()
        route = Route.Done(0, 0)
    }

    fun confirmDelete(items: List<Media>, fromBasket: Kind?) {
        when (val step = trash.request(items)) {
            is DeleteStep.Confirm -> host.launchDelete(step) { ok -> if (ok) onDeleted(step.items, fromBasket) }
            is DeleteStep.Done -> onDeleted(step.deleted, fromBasket)
        }
    }

    /** Omul a anulat dialogul sistemului: pozele rămân marcate, nu se pierde nimic. */
    private fun onDeleted(items: List<Media>, fromBasket: Kind?) {
        if (items.isEmpty()) {
            message = context.getString(com.luminculler.app.R.string.lumin_delete_none)
            return
        }
        val bytes = items.sumOf { it.bytes }
        val ids = items.map { it.id }.toSet()
        store.freedBytes = store.freedBytes + bytes
        store.freedCount = store.freedCount + items.size
        freedBytes = store.freedBytes
        freedCount = store.freedCount
        photos = photos.filter { it.id !in ids }
        videos = videos.filter { it.id !in ids }
        if (fromBasket != null) {
            if (!premium) store.freeBulkUsed = true
        } else {
            marked = emptyList()
            store.pendingDelete = emptyList()
            completeDay()
        }
        scope.launch { regroup() }
        route = Route.Done(bytes, items.size)
        if (!store.reviewAsked && store.freedCount >= 15) {
            store.reviewAsked = true
            host.askReview()
        }
    }

    fun shareFreed() = host.shareFreed(freedBytes)

    fun openPaywall(reason: PaywallReason = PaywallReason.Browse) {
        route = Route.Paywall(reason)
        if (!plansLoaded) scope.launch { loadPlans() }
    }

    suspend fun loadPlans() {
        plans = billing.plans()
        plansLoaded = true
        locked = billing.locked
    }

    private suspend fun refreshBilling() {
        billing.refresh()
        if (!plansLoaded) loadPlans()
        premium = billing.premium
        locked = billing.locked
    }

    fun buy(plan: PlanOffer) {
        if (!host.launchPurchase(plan)) message = context.getString(com.luminculler.app.R.string.lumin_pay_unavailable)
    }

    fun restore() {
        scope.launch {
            val active = billing.refresh()
            premium = billing.premium
            locked = billing.locked
            message = context.getString(
                if (active) com.luminculler.app.R.string.lumin_restore_ok else com.luminculler.app.R.string.lumin_restore_none
            )
            if (active && route is Route.Paywall) route = Route.Today
        }
    }

    private fun onPurchaseResult(bought: Boolean) {
        scope.launch {
            premium = billing.premium
            locked = billing.locked
            if (bought) {
                message = context.getString(com.luminculler.app.R.string.lumin_pay_thanks)
                if (route is Route.Paywall) route = Route.Today
            }
        }
    }

    fun setReminder(on: Boolean) {
        store.dailyReminder = on
        dailyReminder = on
        if (on) host.askNotifications()
        DailyReminderWorker.schedule(context, on)
    }

    /** Recalculează momentele din poze, semnale și oamenii găsiți până acum. */
    fun refreshMoments() {
        momentsJob?.cancel()
        val p = photos
        val s = signals
        val b = baskets
        val people = grow.people
        val t = today()
        momentsJob = scope.launch {
            moments = withContext(Dispatchers.Default) {
                val usable = com.luminculler.app.cleaner.core.Moments.usable(p, s, b)
                com.luminculler.app.cleaner.core.Moments.build(t, zone, usable, s, people)
            }
        }
    }

    fun openStory(moment: com.luminculler.app.cleaner.core.Moment) {
        route = Route.Story(moment)
    }

    fun openMovie(moment: com.luminculler.app.cleaner.core.Moment, title: String) {
        movie.prepare(moment, title)
        route = Route.Movie(moment)
    }

    fun openMagic(media: Media) {
        route = Route.Magic(media, route)
    }

    fun openGrow() {
        grow.open(photos)
        route = Route.Grow
    }

    fun back(): Boolean {
        if (route == Route.Grow && grow.back()) return true
        val r = route
        if (r is Route.Movie && movie.back()) return true
        route = when (r) {
            Route.Moments, Route.Onboarding -> return false
            Route.Today, Route.Settings, Route.Grow, is Route.Story -> Route.Moments
            is Route.Movie -> Route.Story(r.moment)
            is Route.Magic -> r.from
            is Route.Review -> if (r.fromBasket != null) Route.BasketView(r.fromBasket) else Route.Today
            else -> Route.Today
        }
        return true
    }

    fun close() {
        magic.close()
        grow.close()
        scanJob?.cancel()
        billing.close()
    }
}

/** Ce are nevoie modelul de la Activity. */
interface LuminHost {
    fun launchDelete(step: DeleteStep.Confirm, onResult: (Boolean) -> Unit)
    fun launchPurchase(plan: PlanOffer): Boolean
    fun askNotifications()
    fun askReview()
    fun shareFreed(bytes: Long)
}
