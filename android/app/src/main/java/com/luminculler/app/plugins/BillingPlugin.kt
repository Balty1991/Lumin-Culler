package com.luminculler.app.plugins

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
import com.getcapacitor.JSArray
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
 * DOUA produse, nu unul: lunar si anual (vezi PRODUCT_IDS). Anualul e singura
 * parghie reala de venit care nu cere nicio functie noua — in aplicatiile de
 * consum acopera de obicei jumatate din incasari si, mai important, muta
 * decizia de reinnoire de douasprezece ori pe an la o singura data pe an.
 * Codul NU presupune insa ca amandoua exista: `plans()` intoarce exact ce
 * raspunde Play, iar interfata arata ce a primit. Cat timp anualul nu e creat in
 * Play Console, aplicatia se comporta exact ca inainte, cu un singur plan; in
 * ziua in care e creat, apare singur, fara nicio schimbare de cod.
 *
 * CE TREBUIE FACUT IN AFARA CODULUI ca sa functioneze, si fara care metodele de
 * mai jos raspund corect dar gol:
 *  1. In Google Play Console, cate un abonament cu ID-urile din PRODUCT_IDS de
 *     mai jos, fiecare cu cel putin un plan de baza activ. Perioada de proba,
 *     daca o vrei, se adauga ca OFERTA pe planul de baza — nu cere cod: vezi
 *     `bestOffer` si faza de pret gratuita din `describeOffer`.
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

    /** Trebuie sa fie IDENTIC cu ID-urile abonamentelor din Google Play Console. */
    private val monthlyId = "lumin_premium_monthly"
    private val yearlyId = "lumin_premium_yearly"

    /**
     * Ordinea conteaza: e ordinea in care ajung planurile in interfata, si
     * lunarul sta primul fiindca e reperul fata de care se citeste economia
     * anualului.
     */
    private val productIds = listOf(monthlyId, yearlyId)

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
                val active = purchases.filter { p -> p.isActive() && p.products.any { it in productIds } }
                // O achizitie facuta pe alt dispozitiv ajunge aici neconfirmata.
                active.forEach { acknowledge(it) }
                call.resolve(JSObject().put("active", active.isNotEmpty()))
            }
        }
    }

    /**
     * Oferta pe care o aratam si o cumparam, dintre cele pe care Play le
     * intoarce pentru acest produs.
     *
     * Play trimite DOAR ofertele pentru care contul e eligibil, deci un fost
     * abonat nu vede a doua oara perioada de proba — nu avem noi de verificat
     * asta. Ce ramane de ales e intre mai multe oferte valabile simultan (planul
     * de baza + o promotie): preferam una cu faza gratuita, apoi pe cea mai
     * ieftina pe termen lung. Ordinea din lista lui Play NU e o ordine de
     * preferinta, deci `firstOrNull()` (ce era aici inainte) alegea la
     * intamplare intre ele.
     */
    private fun bestOffer(details: ProductDetails): ProductDetails.SubscriptionOfferDetails? {
        val offers = details.subscriptionOfferDetails ?: return null
        return offers.minWithOrNull(
            compareBy<ProductDetails.SubscriptionOfferDetails> { if (freePhase(it) != null) 0 else 1 }
                .thenBy { recurringPhase(it)?.priceAmountMicros ?: Long.MAX_VALUE }
        )
    }

    /**
     * Faza de pret care se plateste LA NESFARSIT — pretul real al abonamentului.
     *
     * NU prima din lista, si asta era un bug care astepta doar sa fie creata o
     * oferta in Play Console: cu o perioada de proba configurata, prima faza e
     * chiar proba, cu pretul 0. `price()` intorcea atunci "0,00 lei", iar
     * ecranul Premium scria, cu litere mari, "Abonează-te — 0,00 lei". Ultima
     * faza e prin definitie cea recurenta (fazele sunt ordonate cronologic);
     * `recurrenceMode` o confirma acolo unde e raportat.
     */
    private fun recurringPhase(offer: ProductDetails.SubscriptionOfferDetails): ProductDetails.PricingPhase? {
        val phases = offer.pricingPhases.pricingPhaseList
        return phases.lastOrNull { it.recurrenceMode == ProductDetails.RecurrenceMode.INFINITE_RECURRING }
            ?: phases.lastOrNull()
    }

    /** Faza gratuita de la inceputul ofertei (perioada de proba), daca exista. */
    private fun freePhase(offer: ProductDetails.SubscriptionOfferDetails): ProductDetails.PricingPhase? {
        val phases = offer.pricingPhases.pricingPhaseList
        // `dropLast(1)`: faza recurenta nu e o proba nici daca ar avea pretul 0.
        return phases.dropLast(1).firstOrNull { it.priceAmountMicros == 0L }
    }

    /**
     * Durata ISO-8601 a lui Play ("P7D", "P1W", "P1M", "P1Y") in zile.
     *
     * Aproximari deliberate pentru luna si an (30 si 365): numarul ajunge intr-o
     * propozitie de tipul "7 zile gratuit", unde diferenta dintre 30 si 31 nu
     * schimba nimic, iar termenul exact il stabileste oricum Play, nu textul
     * nostru. 0 inseamna "n-am putut citi", si interfata nu afiseaza nimic.
     */
    private fun durationDays(period: String?): Int {
        val m = Regex("^P(?:(\\d+)Y)?(?:(\\d+)M)?(?:(\\d+)W)?(?:(\\d+)D)?$").find(period ?: "") ?: return 0
        val (y, mo, w, d) = m.destructured
        return (y.toIntOrNull() ?: 0) * 365 + (mo.toIntOrNull() ?: 0) * 30 +
            (w.toIntOrNull() ?: 0) * 7 + (d.toIntOrNull() ?: 0)
    }

    /** Un plan, asa cum il vede partea de JS. Vezi src/core/billing.ts:PremiumPlan. */
    private fun describePlan(details: ProductDetails): JSObject? {
        val offer = bestOffer(details) ?: return null
        val recurring = recurringPhase(offer) ?: return null
        val out = JSObject()
            .put("id", details.productId)
            .put("price", recurring.formattedPrice)
            // Cifra bruta, ca partea de JS sa poata calcula economia anualului
            // fara sa incerce vreodata sa parseze un pret formatat de Play (care
            // vine in moneda si conventiile contului: "19,99 lei", "$4.99").
            .put("priceMicros", recurring.priceAmountMicros.toString())
            .put("currency", recurring.priceCurrencyCode)
            // Perioada bruta ("P1M"/"P1Y"), nu un cuvant tradus de noi: traducerea
            // e treaba lui i18n, iar aici n-avem limba interfetei.
            .put("period", recurring.billingPeriod)
            .put("periodDays", durationDays(recurring.billingPeriod))
            .put("offerToken", offer.offerToken)
        freePhase(offer)?.let { trial ->
            val days = durationDays(trial.billingPeriod) * maxOf(1, trial.billingCycleCount)
            if (days > 0) out.put("trialDays", days)
        }
        return out
    }

    /**
     * Produsele pe care Play NU le-a putut da, cu motivul fiecaruia — pentru
     * mesajele de eroare.
     *
     * Exista din Billing 8. Inainte, produsele nereusite pur si simplu lipseau
     * din lista, deci "produs neconfigurat in Play Console" si "produs fara nicio
     * oferta valabila pentru contul asta" aratau identic: o lista goala. E
     * singura diferenta care conteaza cand cineva incearca sa afle de ce nu se
     * deschide plata, asa ca nu se pierde pe drum.
     */
    private var lastUnfetched: String = "none reported"

    private fun queryProducts(call: PluginCall, onResult: (List<ProductDetails>) -> Unit) {
        val params = QueryProductDetailsParams.newBuilder().setProductList(
            productIds.map {
                QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(it)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build()
            }
        ).build()
        // Din Billing 8, callback-ul primeste un QueryProductDetailsResult, nu
        // direct List<ProductDetails> — vezi comentariul de la subscribe().
        client.queryProductDetailsAsync(params) { result, productDetailsResult ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                call.reject("Could not read products: ${result.debugMessage} (${result.responseCode})")
                return@queryProductDetailsAsync
            }
            lastUnfetched = productDetailsResult.unfetchedProductList
                .joinToString { "${it.productId} (status ${it.statusCode})" }
                .ifEmpty { "none reported" }
            // Ordinea din productIds, nu cea in care raspunde Play: interfata
            // asaza planurile in ordinea primita, si aia n-are voie sa se schimbe
            // de la o pornire la alta.
            val byId = productDetailsResult.productDetailsList.associateBy { it.productId }
            onResult(productIds.mapNotNull { byId[it] })
        }
    }

    /**
     * Toate planurile pe care contul acesta chiar le poate cumpara ACUM.
     *
     * O lista goala inseamna acelasi lucru ca un `price()` fara pret: produsele
     * nu sunt configurate, sau build-ul nu e semnat. Un plan care lipseste
     * (tipic: anualul, cat timp nu e creat in Play Console) pur si simplu nu
     * apare — nu e o eroare, si nu impiedica restul.
     */
    @PluginMethod
    fun plans(call: PluginCall) {
        withConnection(call) {
            queryProducts(call) { products ->
                val plans = JSArray()
                for (details in products) describePlan(details)?.let { plans.put(it) }
                call.resolve(JSObject().put("plans", plans))
            }
        }
    }

    /**
     * Pretul planului LUNAR, formatat de Play in moneda si limba contului —
     * niciodata scris de noi in cod.
     *
     * Ramane separat de `plans()` fiindca e intrebarea la care atarna tot
     * modelul freemium (core/entitlement.ts:isPurchasable — "exista pe acest
     * telefon o cale reala de plata?"), si acolo un raspuns nul trebuie sa
     * insemne exact "nu exista produs", nu "lista are alta forma".
     */
    @PluginMethod
    fun price(call: PluginCall) {
        withConnection(call) {
            queryProducts(call) { products ->
                val monthly = products.firstOrNull { it.productId == monthlyId } ?: products.firstOrNull()
                val out = JSObject()
                // Absent, nu gol: UI-ul trebuie sa poata deosebi "inca nu stiu
                // pretul" (produs neconfigurat, build nesemnat) de un pret real.
                monthly?.let { d -> bestOffer(d)?.let { recurringPhase(it) } }
                    ?.formattedPrice?.let { out.put("price", it) }
                call.resolve(out)
            }
        }
    }

    /**
     * Deschide fluxul de cumparare al lui Play pentru planul cerut. Rezultatul
     * vine pe purchasesUpdated, nu de aici.
     *
     * `productId` e optional si cade pe lunar cand lipseste — asa apelurile
     * vechi (si orice ecran care n-are inca de ales) se comporta exact ca
     * inainte. Un id necunoscut e respins, nu inlocuit tacut cu altul: a incasa
     * alt abonament decat cel pe care a apasat omul ar fi mai rau decat o
     * eroare.
     */
    @PluginMethod
    fun subscribe(call: PluginCall) {
        val wanted = call.getString("productId") ?: monthlyId
        if (wanted !in productIds) {
            call.reject("Unknown subscription plan: $wanted")
            return
        }
        withConnection(call) {
            /*
             * Din Billing 8, `onProductDetailsResponse` primeste un
             * QueryProductDetailsResult in loc de List<ProductDetails> — singura
             * schimbare care rupea compilarea la migrarea de la v7. Obiectul nou
             * poarta si `unfetchedProductList`: produsele care n-au putut fi
             * aduse, fiecare cu motivul lui. Inainte pur si simplu lipseau din
             * lista, deci "produs neconfigurat in Play Console" si "produs fara
             * nicio oferta valabila pentru contul asta" aratau identic — o lista
             * goala. Vezi mesajul de eroare de mai jos.
             */
            queryProducts(call) { products ->
                val details = products.firstOrNull { it.productId == wanted }
                val offerToken = details?.let { bestOffer(it) }?.offerToken
                if (details == null || offerToken == null) {
                    call.reject(
                        "Subscription not available — check that '$wanted' exists in Play Console " +
                            "with an active base plan, and that the build is signed. Unfetched: $lastUnfetched"
                    )
                    return@queryProducts
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
