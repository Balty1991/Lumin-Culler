package com.luminculler.app;

import android.os.Bundle;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import com.luminculler.app.plugins.FaceDetectionPlugin;
import com.luminculler.app.plugins.ImageAnalysisPlugin;
import com.luminculler.app.plugins.ImageLabelingPlugin;
import com.luminculler.app.plugins.FaceMeshPlugin;
import com.luminculler.app.plugins.ImageClassifierPlugin;
import com.luminculler.app.plugins.TextRecognitionPlugin;
import com.luminculler.app.plugins.PoseDetectionPlugin;
import com.luminculler.app.plugins.SegmentationPlugin;
import com.luminculler.app.plugins.ImageEmbedderPlugin;
import com.luminculler.app.plugins.FolderExportPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin-urile native LOCALE (nu pachete npm separate, ca @capacitor/filesystem)
        // nu sunt descoperite automat de Capacitor — trebuie inregistrate explicit aici,
        // inainte de super.onCreate(). Vezi plugins/FaceDetectionPlugin.kt / ImageAnalysisPlugin.kt /
        // ImageLabelingPlugin.kt / FaceMeshPlugin.kt / ImageClassifierPlugin.kt /
        // TextRecognitionPlugin.kt / PoseDetectionPlugin.kt / SegmentationPlugin.kt / ImageEmbedderPlugin.kt /
        // FolderExportPlugin.kt.
        registerPlugin(FaceDetectionPlugin.class);
        registerPlugin(ImageAnalysisPlugin.class);
        registerPlugin(ImageLabelingPlugin.class);
        registerPlugin(FaceMeshPlugin.class);
        registerPlugin(ImageClassifierPlugin.class);
        registerPlugin(TextRecognitionPlugin.class);
        registerPlugin(PoseDetectionPlugin.class);
        registerPlugin(SegmentationPlugin.class);
        registerPlugin(ImageEmbedderPlugin.class);
        registerPlugin(FolderExportPlugin.class);
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
    }
}
