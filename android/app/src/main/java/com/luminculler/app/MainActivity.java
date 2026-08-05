package com.luminculler.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.luminculler.app.plugins.FaceDetectionPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin-urile native LOCALE (nu pachete npm separate, ca @capacitor/filesystem)
        // nu sunt descoperite automat de Capacitor — trebuie inregistrate explicit aici,
        // inainte de super.onCreate(). Vezi plugins/FaceDetectionPlugin.kt.
        registerPlugin(FaceDetectionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
