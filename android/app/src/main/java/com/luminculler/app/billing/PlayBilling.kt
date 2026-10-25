package com.luminculler.app.billing

import android.app.Activity
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams

enum class BillingNotice { Restored, NoPurchase, Unavailable }

data class PlanOffer(
    val productId: String,
    val kind: String,
    val price: String,
    val priceMicros: Long,
    val currency: String,
    val trialDays: Int,
    val offerToken: String
)

data class BillingSnapshot(
    val loading: Boolean = true,
    val connected: Boolean = false,
    val premium: Boolean = false,
    val purchasable: Boolean = false,
    val answered: Boolean = false,
    val plans: List<PlanOffer> = emptyList(),
    val notice: BillingNotice? = null
) {
    companion object {
        fun cached(activity: Activity) = BillingSnapshot(
            loading = true,
            premium = EntitlementStore.isPremium(activity),
            purchasable = EntitlementStore.isPurchasable(activity),
            answered = EntitlementStore.hasAnswered(activity)
        )
    }
}

/**
 * Play Billing for the native cleaner. Prices on screen are the strings Play
 * returns. Nothing here is a price we invented, and nothing is sent to a server.
 */
class PlayBilling(
    private val activity: Activity,
    private val onSnapshot: (BillingSnapshot) -> Unit
) : PurchasesUpdatedListener {
    private var plans: List<PlanOffer> = emptyList()
    private var detailsById: Map<String, ProductDetails> = emptyMap()
    private var notice: BillingNotice? = null
    private var loading = true
    private var connected = false

    private val client: BillingClient = BillingClient.newBuilder(activity)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    fun start() {
        emit()
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                connected = result.responseCode == BillingClient.BillingResponseCode.OK
                if (!connected) {
                    loading = false
                    notice = BillingNotice.Unavailable
                    emit()
                    return
                }
                refresh(afterRestore = false)
            }

            override fun onBillingServiceDisconnected() {
                connected = false
            }
        })
    }

    fun stop() {
        if (client.isReady) client.endConnection()
    }

    fun restore() {
        if (!client.isReady) {
            notice = BillingNotice.Unavailable
            emit()
            return
        }
        refresh(afterRestore = true)
    }

    fun buy(productId: String) {
        val details = detailsById[productId] ?: return
        val offer = plans.firstOrNull { it.productId == productId } ?: return
        if (offer.offerToken.isBlank()) return
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(
            listOf(
                BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(details)
                    .setOfferToken(offer.offerToken)
                    .build()
            )
        ).build()
        activity.runOnUiThread {
            client.launchBillingFlow(activity, params)
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        if (result.responseCode == BillingClient.BillingResponseCode.OK) {
            purchases?.forEach { acknowledge(it) }
            val active = purchases?.any { it.isPurchased() && it.products.any { id -> id in PremiumIds.all } } == true
            if (active) EntitlementStore.setPremium(activity, true)
            refresh(afterRestore = false)
        }
    }

    private fun refresh(afterRestore: Boolean) {
        queryType(BillingClient.ProductType.SUBS, PremiumIds.subscriptions) { subs ->
            queryType(BillingClient.ProductType.INAPP, listOf(PremiumIds.LIFETIME)) { lifetime ->
                val products = (subs.orEmpty() + lifetime.orEmpty())
                if (subs != null || lifetime != null) {
                    detailsById = products.associateBy { it.productId }
                    plans = PremiumIds.all.mapNotNull { id -> detailsById[id]?.let { describe(it) } }
                    val purchasable = plans.isNotEmpty()
                    EntitlementStore.setPurchasable(activity, purchasable)
                    EntitlementStore.setAnswered(activity, true)
                }
                readPurchases(afterRestore)
            }
        }
    }

    private fun readPurchases(afterRestore: Boolean) {
        queryPurchases(BillingClient.ProductType.SUBS) { subsOk, subs ->
            queryPurchases(BillingClient.ProductType.INAPP) { inAppOk, inApp ->
                val subsActive = subs.any { it.isPurchased() && it.products.any { id -> id in PremiumIds.subscriptions } }
                val lifeActive = inApp.any { it.isPurchased() && it.products.any { id -> id == PremiumIds.LIFETIME } }
                (subs + inApp).forEach { acknowledge(it) }
                when {
                    subsActive || lifeActive -> EntitlementStore.setPremium(activity, true)
                    subsOk && inAppOk -> EntitlementStore.setPremium(activity, false)
                }
                notice = if (!afterRestore) notice else {
                    if (EntitlementStore.isPremium(activity)) BillingNotice.Restored else BillingNotice.NoPurchase
                }
                loading = false
                emit()
            }
        }
    }

    private fun queryType(type: String, ids: List<String>, done: (List<ProductDetails>?) -> Unit) {
        if (!client.isReady || ids.isEmpty()) {
            done(emptyList())
            return
        }
        val params = QueryProductDetailsParams.newBuilder().setProductList(
            ids.map {
                QueryProductDetailsParams.Product.newBuilder().setProductId(it).setProductType(type).build()
            }
        ).build()
        client.queryProductDetailsAsync(params) { result, details ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) done(null)
            else done(details.productDetailsList)
        }
    }

    private fun queryPurchases(type: String, done: (Boolean, List<Purchase>) -> Unit) {
        if (!client.isReady) {
            done(false, emptyList())
            return
        }
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(type).build()) { result, purchases ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) done(false, emptyList())
            else done(true, purchases)
        }
    }

    private fun acknowledge(purchase: Purchase) {
        if (!purchase.isPurchased() || purchase.isAcknowledged || !client.isReady) return
        client.acknowledgePurchase(
            AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()
        ) { }
    }

    private fun emit() {
        val snapshot = BillingSnapshot(
            loading = loading,
            connected = connected,
            premium = EntitlementStore.isPremium(activity),
            purchasable = EntitlementStore.isPurchasable(activity),
            answered = EntitlementStore.hasAnswered(activity),
            plans = plans,
            notice = notice
        )
        activity.runOnUiThread { onSnapshot(snapshot) }
    }

    private fun describe(details: ProductDetails): PlanOffer? {
        if (details.productId == PremiumIds.LIFETIME) {
            val offer = details.oneTimePurchaseOfferDetailsList?.firstOrNull() ?: return null
            val token = offer.offerToken ?: return null
            return PlanOffer(
                productId = details.productId,
                kind = "lifetime",
                price = offer.formattedPrice,
                priceMicros = offer.priceAmountMicros,
                currency = offer.priceCurrencyCode,
                trialDays = 0,
                offerToken = token
            )
        }
        val offer = bestOffer(details) ?: return null
        val recurring = recurringPhase(offer) ?: return null
        val trial = freePhase(offer)
        val days = if (trial == null) 0 else durationDays(trial.billingPeriod) * maxOf(1, trial.billingCycleCount)
        return PlanOffer(
            productId = details.productId,
            kind = if (durationDays(recurring.billingPeriod) > 31) "yearly" else "monthly",
            price = recurring.formattedPrice,
            priceMicros = recurring.priceAmountMicros,
            currency = recurring.priceCurrencyCode,
            trialDays = days,
            offerToken = offer.offerToken
        )
    }
}

private fun Purchase.isPurchased(): Boolean = purchaseState == Purchase.PurchaseState.PURCHASED

private fun bestOffer(details: ProductDetails): ProductDetails.SubscriptionOfferDetails? {
    val offers = details.subscriptionOfferDetails ?: return null
    return offers.minWithOrNull(
        compareBy<ProductDetails.SubscriptionOfferDetails> { if (freePhase(it) != null) 0 else 1 }
            .thenBy { recurringPhase(it)?.priceAmountMicros ?: Long.MAX_VALUE }
    )
}

private fun recurringPhase(offer: ProductDetails.SubscriptionOfferDetails): ProductDetails.PricingPhase? {
    val phases = offer.pricingPhases.pricingPhaseList
    return phases.lastOrNull { it.recurrenceMode == ProductDetails.RecurrenceMode.INFINITE_RECURRING } ?: phases.lastOrNull()
}

private fun freePhase(offer: ProductDetails.SubscriptionOfferDetails): ProductDetails.PricingPhase? {
    val phases = offer.pricingPhases.pricingPhaseList
    return phases.dropLast(1).firstOrNull { it.priceAmountMicros == 0L }
}

private fun durationDays(period: String?): Int {
    val match = Regex("^P(?:(\\d+)Y)?(?:(\\d+)M)?(?:(\\d+)W)?(?:(\\d+)D)?$").find(period ?: "") ?: return 0
    val (years, months, weeks, days) = match.destructured
    return (years.toIntOrNull() ?: 0) * 365 + (months.toIntOrNull() ?: 0) * 30 +
        (weeks.toIntOrNull() ?: 0) * 7 + (days.toIntOrNull() ?: 0)
}
