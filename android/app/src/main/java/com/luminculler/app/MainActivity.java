package com.luminculler.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.luminculler.app.plugins.FaceDetectionPlugin;
import com.luminculler.app.plugins.ImageAnalysisPlugin;
import com.luminculler.app.plugins.ObjectDetectionPlugin;
import com.luminculler.app.plugins.FaceMeshPlugin;
import com.luminculler.app.plugins.ImageClassifierPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin-urile native LOCALE (nu pachete npm separate, ca @capacitor/filesystem)
        // nu sunt descoperite automat de Capacitor — trebuie inregistrate explicit aici,
        // inainte de super.onCreate(). Vezi plugins/FaceDetectionPlugin.kt / ImageAnalysisPlugin.kt /
        // ObjectDetectionPlugin.kt / FaceMeshPlugin.kt / ImageClassifierPlugin.kt.
        registerPlugin(FaceDetectionPlugin.class);
        registerPlugin(ImageAnalysisPlugin.class);
        registerPlugin(ObjectDetectionPlugin.class);
        registerPlugin(FaceMeshPlugin.class);
        registerPlugin(ImageClassifierPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
