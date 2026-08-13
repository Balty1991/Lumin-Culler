package com.luminculler.app.plugins

import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Abonamentul Premium, prin Google Play Billing.
 *
 * Scris de mana peste billing-ktx, ca toate celelalte plugin-uri din proiect —
 * nu printr-un wrapper Cordova/Capacitor tert. Motivul e acelasi ca la
 * FaceDetection/ImageAnalysis: suprafata de care avem nevoie e mica (trei
 * operatii), iar un wrapper ar aduce un ciclu de intretinere strain pentru
 * exact codul care decide daca utilizatorul a platit.
 *
 * CE TREBUIE FACUT IN AFARA CODULUI ca sa functioneze, si fara care metodele de
 * mai jos raspund corect dar gol:
 *  1. In Google Play Console, un abonament cu ID-ul din SUBSCRIPTION_ID de mai
 *     jos, cu cel putin un plan de baza activ.
 *  2. Aplicatia incarcata (macar pe un canal de test intern) si SEMNATA cu
 *     cheia de release — Play Billing nu raspunde niciodata unui APK de debug
 *     instalat cu adb.
 *  3. Contul de test adaugat ca licensed tester in Play Console.
 * Pana atunci, connect() reuseste, iar `products` si `active` vin goale — adica
 * exact ce se intampla si pentru un utilizator care n-a cumparat nimic.
 *
 * LIMITA DE INCREDERE, spusa aici pentru ca e o decizie de arhitectura, nu o
 * scapare: aplicatia nu are server, deci nu exista validare de chitanta pe
 * partea noastra. Ne bazam pe raspunsul lui Play de pe dispozitiv. Un utilizator
 * hotarat poate ocoli asta. Pentru un abonament de consum la o aplicatie
 * locala e compromisul normal — alternativa (server propriu care valideaza
 * token-ul prin Play Developer API) contrazice direct promisiunea ca nimic nu
 * pleaca de pe telefon.
 */
@CapacitorPlugin(name = "Billing")
class BillingPlugin : Plugin() {

    /** Trebuie sa fie IDENTIC cu ID-ul abonamentului din Google Play Console. */
    private val subscriptionId = "lumin_premium_monthly"

    private var pendingPurchaseCall: PluginCall? = null

    /**
     * Play trimite rezultatul cumpararii pe acest listener, NU ca rezultat al
     * apelului care a lansat fluxul — de aceea apelul din JS e tinut in
     * `pendingPurchaseCall` si rezolvat abia aici.
     */
    private val purchasesUpdated = PurchasesUpdatedListener { result, purchases ->
        val call = pendingPurchaseCall
        pendingPurchaseCall = null
        when {
            result.responseCode == BillingClient.BillingResponseCode.USER_CANCELED -> {
                call?.resolve(JSObject().put("purchased", false).put("cancelled", true))
            }
            result.responseCode != BillingClient.BillingResponseCode.OK -> {
                call?.reject("Billing flow failed: ${result.debugMessage} (${result.responseCode})")
            }
            else -> {
                purchases?.forEach { acknowledge(it) }
                call?.resolve(JSObject().put("purchased", purchases?.any { it.isActive() } == true).put("cancelled", false))
            }
        }
    }

    private val client: BillingClient by lazy {
        BillingClient.newBuilder(context)
            .setListener(purchasesUpdated)
            // Obligatoriu din Billing 7 chiar si cand nu folosim produse consumabile.
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build()
    }

    /**
     * `PURCHASED`, nu doar "exista": o achizitie poate fi si PENDING (plata in
     * curs, ex. la casa de marcat, in tarile unde Play o ofera). A trata o plata
     * neincheiata ca abonament activ ar da Premium gratis oricui incepe o plata
     * si n-o duce la capat.
     */
    private fun Purchase.isActive(): Boolean = purchaseState == Purchase.PurchaseState.PURCHASED

    /**
     * O achizitie neconfirmata in 3 zile e RAMBURSATA automat de Google. E
     * singurul pas din tot fluxul care, omis, ii ia utilizatorului banii inapoi
     * fara ca nimeni sa observe imediat.
     */
    private fun acknowledge(purchase: Purchase) {
        if (!purchase.isActive() || purchase.isAcknowledged) return
        client.acknowledgePurchase(
            AcknowledgePurchaseParams.newBuilder().setPurchaseToken(purchase.purchaseToken).build()
        ) { /* esecul se reia singur: reincercam la urmatorul status() */ }
    }

    private fun withConnection(call: PluginCall, block: () -> Unit) {
        if (client.isReady) { block(); return }
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) block()
                else call.reject("Billing unavailable: ${result.debugMessage} (${result.responseCode})")
            }
            override fun onBillingServiceDisconnected() {
                // fara reconectare agresiva aici: urmatorul apel din JS reia
                // conexiunea oricum, si o bucla de retry ar tine radioul pornit
            }
        })
    }

    /**
     * Starea abonamentului ACUM, direct de la Play. Sursa unica de adevar —
     * partea de JS nu are voie sa decida singura ca cineva e abonat.
     */
    @PluginMethod
    fun status(call: PluginCall) {
        withConnection(call) {
            client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()
            ) { result, purchases ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    call.reject("Could not read purchases: ${result.debugMessage} (${result.responseCode})")
                    return@queryPurchasesAsync
                }
                val active = purchases.filter { it.isActive() && it.products.contains(subscriptionId) }
                // O achizitie facuta pe alt dispozitiv ajunge aici neconfirmata.
                active.forEach { acknowledge(it) }
                call.resolve(JSObject().put("active", active.isNotEmpty()))
            }
        }
    }

    /** Pretul, formatat de Play in moneda si limba contului — niciodata scris de noi in cod. */
    @PluginMethod
    fun price(call: PluginCall) {
        withConnection(call) {
            val params = QueryProductDetailsParams.newBuilder().setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(subscriptionId)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()
                )
            ).build()
            client.queryProductDetailsAsync(params) { result, productDetailsList ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    call.reject("Could not read product: ${result.debugMessage} (${result.responseCode})")
                    return@queryProductDetailsAsync
                }
                val offer = productDetailsList.firstOrNull()
                    ?.subscriptionOfferDetails?.firstOrNull()
                    ?.pricingPhases?.pricingPhaseList?.firstOrNull()
                val out = JSObject()
                // Absent, nu gol: UI-ul trebuie sa poata deosebi "inca nu stiu
                // pretul" (produs neconfigurat, build nesemnat) de un pret real.
                offer?.formattedPrice?.let { out.put("price", it) }
                call.resolve(out)
            }
        }
    }

    /** Deschide fluxul de cumparare al lui Play. Rezultatul vine pe purchasesUpdated, nu de aici. */
    @PluginMethod
    fun subscribe(call: PluginCall) {
        withConnection(call) {
            val params = QueryProductDetailsParams.newBuilder().setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(subscriptionId)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build()
                )
            ).build()
            client.queryProductDetailsAsync(params) { result, productDetailsList ->
                val details = productDetailsList.firstOrNull()
                val offerToken = details?.subscriptionOfferDetails?.firstOrNull()?.offerToken
                if (result.responseCode != BillingClient.BillingResponseCode.OK || details == null || offerToken == null) {
                    call.reject("Subscription not available — check that '$subscriptionId' exists in Play Console and the build is signed.")
                    return@queryProductDetailsAsync
                }
                val flowParams = BillingFlowParams.newBuilder().setProductDetailsParamsList(
                    listOf(
                        BillingFlowParams.ProductDetailsParams.newBuilder()
                            .setProductDetails(details)
                            .setOfferToken(offerToken)
                            .build()
                    )
                ).build()
                // `call` e tinut deschis pana raspunde listener-ul; setKeepAlive
                // impiedica Capacitor sa-l elibereze la iesirea din metoda.
                call.setKeepAlive(true)
                pendingPurchaseCall = call
                activity.runOnUiThread {
                    val launch = client.launchBillingFlow(activity, flowParams)
                    if (launch.responseCode != BillingClient.BillingResponseCode.OK) {
                        pendingPurchaseCall = null
                        call.reject("Could not open the purchase flow: ${launch.debugMessage} (${launch.responseCode})")
                    }
                }
            }
        }
    }

    override fun handleOnDestroy() {
        pendingPurchaseCall = null
        if (client.isReady) client.endConnection()
        super.handleOnDestroy()
    }
}
