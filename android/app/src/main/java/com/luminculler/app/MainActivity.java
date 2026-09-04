package com.luminculler.app;

import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import com.luminculler.app.plugins.FaceDetectionPlugin;
import com.luminculler.app.plugins.ImageAnalysisPlugin;
import com.luminculler.app.plugins.ImageLabelingPlugin;
import com.luminculler.app.plugins.FaceMeshPlugin;
import com.luminculler.app.plugins.TextRecognitionPlugin;
import com.luminculler.app.plugins.PoseDetectionPlugin;
import com.luminculler.app.plugins.SegmentationPlugin;
import com.luminculler.app.plugins.DiagnosticsPlugin;
import com.luminculler.app.plugins.HeicDecoderPlugin;
import com.luminculler.app.plugins.ImageDescriptionPlugin;
import com.luminculler.app.plugins.ImageEmbedderPlugin;
import com.luminculler.app.plugins.FolderExportPlugin;
import com.luminculler.app.plugins.MediaLibraryPlugin;
import com.luminculler.app.plugins.NotificationsPlugin;
import com.luminculler.app.plugins.BillingPlugin;

public class MainActivity extends BridgeActivity {

    /**
     * Cererea explicita din cerintele de calitate Google Play (praguri de
     * memorie, februarie 2027): aplicatia trebuie sa raspunda la onTrimMemory
     * eliberand memoria tinuta, iar esantionarea se face LA SCURT TIMP dupa o
     * schimbare de stare — deci nu e loc de asteptat.
     *
     * ATENTIE, si de-aia arata mai sarac decat era: AICI NU SE MAI INCHID
     * MODELELE NATIVE.
     *
     * Le inchideam, prin ModelRegistry.releaseAll(). Contorul de folosire din
     * ReleasableModel trebuia sa sara peste un model aflat in lucru, dar avea o
     * cursa reala: release() citea contorul pe zero in afara oricarui lacat, iar
     * intre citire si inchidere incapea un beginUse() intreg — alt fir isi
     * crestea contorul si primea modelul, iar release() il inchidea dupa aceea.
     * Inchiderea unei resurse native folosite pe alt fir nu e o exceptie de
     * prins, e procesul omorat in tacere. Semnatura se potrivea exact cu ce se
     * vedea: analiza pornea, si aplicatia disparea fara mesaj.
     *
     * CURSA ACEEA NU MAI EXISTA: achizitia (creste contorul + ia modelul) si
     * verificarea din release() se fac acum sub acelasi lacat, deci sunt
     * indivizibile una fata de cealalta — vezi ReleasableModel.
     *
     * Si totusi linia RAMANE scoasa, deliberat. Un primitiv corect prin
     * constructie nu e acelasi lucru cu o schimbare de comportament verificata
     * pe telefon, iar asta e o schimbare care, cand greseste, nu da eroare —
     * omoara procesul. Pragul de memorie Play intra in vigoare abia in
     * februarie 2027; nu se reactiveaza inaintea unei lansari, ci dupa, cu un
     * test pe device (import lung, aplicatia trimisa in fundal la mijloc).
     *
     * Ce mai ramane e cache-ul de bitmap-uri, unde se dau drumul doar
     * referintelor — fara nimic nativ de inchis, fara cursa.
     */
    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= TRIM_MEMORY_UI_HIDDEN) {
            // Pozele decodate din cache pleaca odata cu modelele — ele sunt
            // memoria bitmap propriu-zisa. Vezi releaseBitmapCache: se dau
            // drumul referintelor, NU se recicleaza, fiindca un model poate
            // inca sa tina una.
            com.luminculler.app.plugins.BitmapUtilsKt.releaseBitmapCache();
            // ModelRegistry.releaseAll() NU se cheama de aici. Cursa care a
            // scos-o e reparata (vezi nota de mai sus si ReleasableModel), dar
            // reintoarcerea ei e o schimbare de comportament care, cand
            // greseste, omoara procesul in loc sa dea o eroare — deci se face
            // dupa lansare, cu un test pe device, nu inaintea ei.
            // Si partea de JS: miniaturile si previzualizarile tinute in cache au
            // in spate imagini DECODATE, care se numara la pragul de memorie
            // bitmap. Se anunta aici, nu se asteapta `visibilitychange`, tocmai
            // fiindca momentul asta e cel in care Play masoara.
            // Vezi core/backgroundMemory.ts.
            if (getBridge() != null) {
                getBridge().triggerWindowJSEvent("luminTrimMemory");
            }
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin-urile native LOCALE (nu pachete npm separate, ca @capacitor/filesystem)
        // nu sunt descoperite automat de Capacitor — trebuie inregistrate explicit aici,
        // inainte de super.onCreate(). Vezi plugins/FaceDetectionPlugin.kt / ImageAnalysisPlugin.kt /
        // ImageLabelingPlugin.kt / FaceMeshPlugin.kt / TextRecognitionPlugin.kt /
        // PoseDetectionPlugin.kt / ImageEmbedderPlugin.kt / FolderExportPlugin.kt /
        // MediaLibraryPlugin.kt / NotificationsPlugin.kt / BillingPlugin.kt.
        //
        // ImageClassifier (EfficientNet-Lite0, 17,7 MB) ramane scos: era un port
        // de proba nelegat niciodata de analiza reala (vezi nativeAnalysis.ts),
        // iar modelul lui intra in FIECARE instalare degeaba.
        //
        // Segmentation a fost scos atunci din acelasi motiv si s-a intors acum
        // cu un motiv: bokeh-ul din editor. Bug real, raportat de utilizator de
        // trei ori ("Bokeh, nu detecteaza persoana, sa o separe de fundal") —
        // linia de mai jos lipsea, deci Capacitor.isPluginAvailable('Segmentation')
        // intorcea false pe telefon, orice ar fi facut partea de JS, si bokeh-ul
        // cadea mereu pe rezerva cu caseta fetei. Modelul care vine cu el nu mai
        // e selfie_multiclass (16,4 MB), ci selfie_segmenter (249 KB) — vezi
        // pasul "Bundle native segmentation model" din workflow-urile de build.
        registerPlugin(FaceDetectionPlugin.class);
        registerPlugin(ImageAnalysisPlugin.class);
        registerPlugin(ImageLabelingPlugin.class);
        registerPlugin(FaceMeshPlugin.class);
        registerPlugin(TextRecognitionPlugin.class);
        registerPlugin(PoseDetectionPlugin.class);
        registerPlugin(SegmentationPlugin.class);
        // Jurnalul de pasi. Se porneste PRIMUL, inainte de orice plugin, ca sa
        // prinda si o cadere survenita in timpul pornirii. Vezi
        // plugins/CrashLog.kt: singurul lucru care supravietuieste unei
        // inchideri fortate e ce a apucat sa ajunga pe disc.
        com.luminculler.app.plugins.CrashLog.INSTANCE.porneste(getApplicationContext());
        registerPlugin(DiagnosticsPlugin.class);
        registerPlugin(HeicDecoderPlugin.class);
        registerPlugin(ImageDescriptionPlugin.class);
        registerPlugin(ImageEmbedderPlugin.class);
        registerPlugin(FolderExportPlugin.class);
        registerPlugin(MediaLibraryPlugin.class);
        registerPlugin(NotificationsPlugin.class);
        registerPlugin(BillingPlugin.class);
        super.onCreate(savedInstanceState);

        // Fara acest listener, un crash al PROCESULUI DE RANDARE al WebView-ului
        // (ex. un driver GPU care pica la crearea unui context WebGL — vezi
        // comentariile din faceAnalysis.worker.ts despre exact acest tip de device
        // cu WebGL blocklist-uit de Chromium) omoara implicit INTREAGA aplicatie,
        // nu doar pagina — spre deosebire de un tab obisnuit de Chrome, care
        // izoleaza un asemenea crash per tab. Simptom real raportat pe device: la
        // "Se incarca modelele AI" (exact cand ruleaza cascada WebGPU->WebGL->CPU
        // din workerPool.ts), aplicatia iese singura, desi acelasi cod JS ruleaza
        // corect intr-un tab de browser pe acelasi telefon — asta arata ca
        // problema e specifica randarii native WebView, nu logicii JS. Returnand
        // true si reincarcand pagina, aplicatia ramane in viata si utilizatorul
        // primeste o noua incercare in loc de o iesire silentioasa completa.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                Log.e("LuminCuller", "WebView render process gone (didCrash=" + detail.didCrash() + ") — reincarc pagina in loc sa las aplicatia sa cada.");
                webView.post(webView::reload);
                return true;
            }
        });

        publishSafeAreaInsets();
    }

    /**
     * Trece inaltimile REALE ale barelor de sistem catre CSS, ca --safe-top si
     * --safe-bottom.
     *
     * De ce e nevoie, si de ce nu mai ajunge ce era: "manerul lipit de bara de
     * navigare" a fost raportat de trei ori pe telefon real. Reparatia de atunci
     * a fost android:windowOptOutEdgeToEdgeEnforcement, declarata "imposibila
     * structural" — sistemul rezerva el spatiul, deci WebView-ul nu mai putea
     * desena sub bara.
     *
     * Doar ca atributul acela era o portita TEMPORARA din Android 15, si e
     * IGNORAT pentru aplicatiile care tintesc SDK 36 pe Android 16 — iar
     * variables.gradle e la 36. Pe telefoanele cu Android 16, WebView-ul deseneaza
     * din nou sub bare, si problema se intoarce intacta.
     *
     * Ce o face greu de reparat din CSS: WebView-ul Capacitor NU propaga
     * inaltimea barei catre env(safe-area-inset-bottom) — CSS-ul primeste 0 desi
     * bara chiar acopera continutul. De-aia nicio incrementare de padding n-a
     * ajuns vreodata: se adauga spatiu peste o valoare care ramanea zero.
     *
     * Singurul loc care stie adevarul e Android. Il citim de aici si il scriem in
     * exact variabilele pe care foaia de stil le foloseste deja (styles.css:143),
     * deci restul aplicatiei nu se schimba deloc — inclusiv ContextMenu.tsx, care
     * le citea deja din JS. env() ramane valoarea de rezerva, pentru cazul in care
     * ascultatorul nu apuca sa ruleze.
     */
    private void publishSafeAreaInsets() {
        final WebView webView = getBridge().getWebView();
        if (webView == null) return;
        webView.setOnApplyWindowInsetsListener((view, insets) -> {
            final float density = getResources().getDisplayMetrics().density;
            int top;
            int bottom;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                // Barele de sistem SI decupajul ecranului (camera in ecran): un
                // element lipit de marginea de sus trebuie sa le ocoleasca pe
                // amandoua, nu doar bara de stare.
                android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                top = bars.top;
                bottom = bars.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            final int topPx = Math.round(top / density);
            final int bottomPx = Math.round(bottom / density);
            view.post(() -> webView.evaluateJavascript(
                "document.documentElement.style.setProperty('--safe-top','" + topPx + "px');"
              + "document.documentElement.style.setProperty('--safe-bottom','" + bottomPx + "px');",
                null));
            return insets;
        });
        // Insets-urile pot sosi INAINTE ca pagina sa fie gata sa le primeasca
        // (listenerul ruleaza la primul layout, evaluateJavascript pe un document
        // gol nu are ce seta). Cererea de mai jos le re-livreaza dupa ce pagina a
        // terminat de incarcat.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView wv) {
                wv.post(() -> ((View) wv).requestApplyInsets());
            }
        });
    }
}
