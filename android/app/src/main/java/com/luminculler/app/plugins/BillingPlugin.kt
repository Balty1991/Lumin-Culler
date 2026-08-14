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
 * Abonamentul Premium, prin Google Play Billing (biblioteca v9 — vezi
 * billingVersion in android/variables.gradle).
 *
 * De ce v9 si nu v7, cu ce a costat: Play Console a semnalat ca de la
 * 31 august 2026 orice actualizare trimisa cu o versiune sub 8.0.0 e respinsa.
 * Migrarea are exact o schimbare care rupe compilarea, iar restul fluxului a
 * ramas neatins: `queryProductDetailsAsync` intoarce acum un
 * QueryProductDetailsResult in loc de List<ProductDetails> (vezi cele doua
 * apeluri de mai jos). Am luat din drum si `enableAutoServiceReconnection()`,
 * adaugat tot in v8.
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
            // Din Billing 8: biblioteca isi reface singura conexiunea cand
            // serviciul Play cade (actualizare a aplicatiei Play, memorie
            // recuperata de sistem). Fara asta, prima operatie de dupa o cadere
            // esua, iar reconectarea ramanea in sarcina noastra.
            //
            // NU inlocuieste coada din withConnection() de mai jos: prima
            // conectare tot noi o pornim, si tot atunci apar apelurile
            // simultane care erau problema.
            .enableAutoServiceReconnection()
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

    /**
     * Apelurile care asteapta ca o conexiune DEJA pornita sa se termine.
     *
     * Bug real gasit la audit: refreshEntitlement() (core/entitlement.ts) cheama
     * status() si price() cu Promise.all, adica DEODATA — iar la prima pornire
     * amandoua gaseau `client.isReady == false` si porneau fiecare cate un
     * startConnection() pe acelasi BillingClient. Un al doilea startConnection
     * peste unul in curs nu e definit sa livreze ambele callback-uri: unul din
     * apeluri putea ramane nerezolvat pentru totdeauna (apel Capacitor scurs,
     * promisiune JS agatata), sau sa fie respins.
     *
     * Simptomul pentru utilizator nu arata deloc a problema de conexiune: un
     * abonat care chiar plateste aparea, din cand in cand, ca neabonat imediat
     * dupa pornire; sau pretul nu se incarca, deci butonul de cumparare nici nu
     * se afisa (vezi PremiumPanel — butonul cere `price` nenul).
     *
     * Acum exista o singura incercare de conectare in zbor, iar toate apelurile
     * sosite intre timp se pun la coada si primesc acelasi raspuns.
     */
    private val pendingConnection = mutableListOf<Pair<PluginCall, () -> Unit>>()
    private var connecting = false

    private fun withConnection(call: PluginCall, block: () -> Unit) {
        if (client.isReady) { block(); return }

        synchronized(pendingConnection) {
            pendingConnection.add(call to block)
            if (connecting) return // deja se conecteaza cineva; asteptam acelasi raspuns
            connecting = true
        }

        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                val waiting = synchronized(pendingConnection) {
                    connecting = false
                    // Golim coada INAINTE de a rula blocurile: unul dintre ele poate
                    // porni un apel nou, care altfel s-ar adauga la o lista pe cale
                    // sa fie parcursa.
                    val copy = pendingConnection.toList()
                    pendingConnection.clear()
                    copy
                }
                val ok = result.responseCode == BillingClient.BillingResponseCode.OK
                for ((waitingCall, waitingBlock) in waiting) {
                    if (ok) waitingBlock()
                    else waitingCall.reject("Billing unavailable: ${result.debugMessage} (${result.responseCode})")
                }
            }

            override fun onBillingServiceDisconnected() {
                // Fara reconectare agresiva: urmatorul apel din JS reia conexiunea
                // oricum, si o bucla de retry ar tine radioul pornit degeaba.
                //
                // Dar coada TREBUIE golita, altfel apelurile care asteptau raman
                // nerezolvate la nesfarsit — exact scurgerea de mai sus, doar pe alt
                // drum (serviciul Play cade in timpul conectarii).
                val waiting = synchronized(pendingConnection) {
                    connecting = false
                    val copy = pendingConnection.toList()
                    pendingConnection.clear()
                    copy
                }
                for ((waitingCall, _) in waiting) waitingCall.reject("Billing service disconnected")
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
            // Din Billing 8, callback-ul primeste un QueryProductDetailsResult, nu
            // direct List<ProductDetails> — vezi comentariul de la subscribe().
            client.queryProductDetailsAsync(params) { result, productDetailsResult ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    call.reject("Could not read product: ${result.debugMessage} (${result.responseCode})")
                    return@queryProductDetailsAsync
                }
                val offer = productDetailsResult.productDetailsList.firstOrNull()
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
            /*
             * Din Billing 8, `onProductDetailsResponse` primeste un
             * QueryProductDetailsResult in loc de List<ProductDetails> — singura
             * schimbare care rupea compilarea la migrarea de la v7. Obiectul nou
             * poarta si `unfetchedProductList`: produsele care n-au putut fi
             * aduse, fiecare cu motivul lui. Inainte pur si simplu lipseau din
             * lista, deci "produs neconfigurat in Play Console" si "produs fara
             * nicio oferta valabila pentru contul asta" aratau identic — o lista
             * goala. Il punem in mesajul de eroare, ca diagnosticarea sa nu mai
             * ceara ghicit.
             */
            client.queryProductDetailsAsync(params) { result, productDetailsResult ->
                val details = productDetailsResult.productDetailsList.firstOrNull()
                val offerToken = details?.subscriptionOfferDetails?.firstOrNull()?.offerToken
                if (result.responseCode != BillingClient.BillingResponseCode.OK || details == null || offerToken == null) {
                    val unfetched = productDetailsResult.unfetchedProductList
                        .joinToString { "${it.productId} (status ${it.statusCode})" }
                        .ifEmpty { "none reported" }
                    call.reject(
                        "Subscription not available — check that '$subscriptionId' exists in Play Console " +
                            "and the build is signed. Unfetched: $unfetched"
                    )
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
        // Rezolvate, nu doar uitate. Bug real: un apel abandonat aici lasa
        // promisiunea din JS neincheiata pentru totdeauna — startSubscription()
        // nu se mai intorcea niciodata, deci `busy` ramanea true si butonul
        // ingheta pe "Se deschide Google Play...", fara nicio cale de iesire in
        // afara de repornirea aplicatiei. Se intampla la ceva absolut banal:
        // rotirea telefonului in timp ce e deschisa foaia de plata a lui Play.
        pendingPurchaseCall?.reject("Activity destroyed before the purchase finished")
        pendingPurchaseCall = null
        val abandoned = synchronized(pendingConnection) {
            connecting = false
            val copy = pendingConnection.toList()
            pendingConnection.clear()
            copy
        }
        for ((call, _) in abandoned) call.reject("Activity destroyed while connecting to Billing")
        if (client.isReady) client.endConnection()
        super.handleOnDestroy()
    }
}
