package com.luminculler.app.cleaner

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.luminculler.app.cleaner.core.Plan
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

enum class PlanKind { Monthly, Yearly, Lifetime }

/** Un plan exact cum l-a dat Play: prețul e textul formatat de Play, niciodată scris de noi. */
class PlanOffer(
    val kind: PlanKind,
    val price: String,
    val priceMicros: Long,
    val trialDays: Int,
    internal val details: ProductDetails,
    internal val offerToken: String
)

/**
 * Google Play Billing pentru ecranul nativ. Aceleași produse ca în
 * plugins/BillingPlugin.kt (partea web), deci un abonament cumpărat într-o
 * parte e văzut și în cealaltă: amândouă întreabă Play, nu un fișier local.
 *
 * Regula care ține modelul cinstit: nimic nu se blochează cât timp Play n-a
 * arătat că există ce cumpăra pe telefonul ăsta (`paymentAvailable`). Un
 * plafon fără ieșire ar fi un perete, nu freemium.
 */
class PlayBilling(context: Context, private val onPurchase: (Boolean) -> Unit) {
    private val prefs = context.getSharedPreferences("lumin_native", Context.MODE_PRIVATE)

    private val client: BillingClient = BillingClient.newBuilder(context.applicationContext)
        .setListener { result, purchases ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK && purchases != null) {
                val active = purchases.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }
                active.forEach { acknowledge(it) }
                if (active.isNotEmpty()) premium = true
                onPurchase(active.isNotEmpty())
            } else {
                onPurchase(false)
            }
        }
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    /** Ultimul răspuns al lui Play, ca să meargă și offline (în avion). */
    var premium: Boolean
        get() = prefs.getBoolean("premium", false)
        private set(v) = prefs.edit().putBoolean("premium", v).apply()

    var paymentAvailable: Boolean
        get() = prefs.getBoolean("paymentAvailable", false)
        private set(v) = prefs.edit().putBoolean("paymentAvailable", v).apply()

    /** Blocăm doar când există o cale reală de plată și omul nu e abonat. */
    val locked: Boolean get() = !premium && paymentAvailable

    private suspend fun connect(): Boolean {
        if (client.isReady) return true
        return suspendCancellableCoroutine { cont ->
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (cont.isActive) cont.resume(result.responseCode == BillingClient.BillingResponseCode.OK)
                }
                override fun onBillingServiceDisconnected() {
                    if (cont.isActive) cont.resume(false)
                }
            })
        }
    }

    /** Reîntreabă Play. Scrie doar după un răspuns; o eroare de rețea nu șterge un abonament. */
    suspend fun refresh(): Boolean {
        if (!connect()) return premium
        val subs = queryPurchases(BillingClient.ProductType.SUBS) ?: return premium
        val inapp = queryPurchases(BillingClient.ProductType.INAPP).orEmpty()
        val active = (subs + inapp).filter { p ->
            p.purchaseState == Purchase.PurchaseState.PURCHASED &&
                p.products.any { it in Plan.SUBSCRIPTION_IDS || it == Plan.LIFETIME_ID }
        }
        active.forEach { acknowledge(it) }
        premium = active.isNotEmpty()
        return premium
    }

    suspend fun plans(): List<PlanOffer> {
        if (!connect()) return emptyList()
        val subs = queryDetails(Plan.SUBSCRIPTION_IDS, BillingClient.ProductType.SUBS)
        val life = queryDetails(listOf(Plan.LIFETIME_ID), BillingClient.ProductType.INAPP)
        val out = ArrayList<PlanOffer>()
        for (d in subs) {
            val offer = bestOffer(d) ?: continue
            val phases = offer.pricingPhases.pricingPhaseList
            val recurring = phases.lastOrNull { it.recurrenceMode == ProductDetails.RecurrenceMode.INFINITE_RECURRING }
                ?: phases.lastOrNull() ?: continue
            val trial = phases.dropLast(1).firstOrNull { it.priceAmountMicros == 0L }
            val trialDays = trial?.let { days(it.billingPeriod) * maxOf(1, it.billingCycleCount) } ?: 0
            val kind = if (d.productId == Plan.YEARLY_ID) PlanKind.Yearly else PlanKind.Monthly
            out.add(PlanOffer(kind, recurring.formattedPrice, recurring.priceAmountMicros, trialDays, d, offer.offerToken))
        }
        for (d in life) {
            val one = d.oneTimePurchaseOfferDetailsList?.firstOrNull() ?: continue
            out.add(PlanOffer(PlanKind.Lifetime, one.formattedPrice, one.priceAmountMicros, 0, d, one.offerToken ?: ""))
        }
        if (out.isNotEmpty()) paymentAvailable = true
        return out.sortedBy { it.kind.ordinal }
    }

    /** Deschide foaia de plată a lui Play. Rezultatul vine pe `onPurchase`. */
    fun launch(activity: Activity, plan: PlanOffer): Boolean {
        if (!client.isReady) return false
        val product = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(plan.details)
        if (plan.offerToken.isNotEmpty()) product.setOfferToken(plan.offerToken)
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(product.build())).build()
        return client.launchBillingFlow(activity, params).responseCode == BillingClient.BillingResponseCode.OK
    }

    fun close() {
        if (client.isReady) client.endConnection()
    }

    private suspend fun queryPurchases(type: String): List<Purchase>? = suspendCancellableCoroutine { cont ->
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(type).build()) { result, list ->
            if (cont.isActive) cont.resume(if (result.responseCode == BillingClient.BillingResponseCode.OK) list else null)
        }
    }

    private suspend fun queryDetails(ids: List<String>, type: String): List<ProductDetails> = suspendCancellableCoroutine { cont ->
        val params = QueryProductDetailsParams.newBuilder().setProductList(
            ids.map { QueryProductDetailsParams.Product.newBuilder().setProductId(it).setProductType(type).build() }
        ).build()
        client.queryProductDetailsAsync(params) { result, details ->
            if (cont.isActive) {
                cont.resume(if (result.responseCode == BillingClient.BillingResponseCode.OK) details.productDetailsList else emptyList())
            }
        }
    }

    /** O achiziție neconfirmată în 3 zile e rambursată automat de Google. */
    private fun acknowledge(p: Purchase) {
        if (p.purchaseState != Purchase.PurchaseState.PURCHASED || p.isAcknowledged) return
        client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) { }
    }

    /** Oferta cu perioadă de probă, dacă Play o dă contului ăstuia; altfel cea mai ieftină. */
    private fun bestOffer(d: ProductDetails): ProductDetails.SubscriptionOfferDetails? =
        d.subscriptionOfferDetails?.minWithOrNull(
            compareBy<ProductDetails.SubscriptionOfferDetails> { o ->
                if (o.pricingPhases.pricingPhaseList.dropLast(1).any { it.priceAmountMicros == 0L }) 0 else 1
            }.thenBy { o -> o.pricingPhases.pricingPhaseList.lastOrNull()?.priceAmountMicros ?: Long.MAX_VALUE }
        )

    private fun days(period: String?): Int {
        val m = Regex("^P(?:(\\d+)Y)?(?:(\\d+)M)?(?:(\\d+)W)?(?:(\\d+)D)?$").find(period ?: "") ?: return 0
        val (y, mo, w, d) = m.destructured
        return (y.toIntOrNull() ?: 0) * 365 + (mo.toIntOrNull() ?: 0) * 30 + (w.toIntOrNull() ?: 0) * 7 + (d.toIntOrNull() ?: 0)
    }
}
