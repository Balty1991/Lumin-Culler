# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ─────────────────────────────────────────────────────────────────────────────
# Reguli de pastrare pentru R8, adaugate odata cu minifyEnabled=true.
#
# De ce a fost pornit R8: optimizarea codului (DEX) e unul dintre cele trei
# praguri de calitate anuntate de Google Play pentru februarie 2027. Pana acum
# build-ul de release avea minifyEnabled=false, adica exact ce semnaleaza Play
# ca "limited DEX optimization".
#
# De ce regulile de mai jos NU sunt optionale: Capacitor gaseste plugin-urile
# prin REFLEXIE, dupa numele clasei si dupa adnotari. R8 nu are cum sa vada acele
# legaturi — pentru el o clasa la care nimeni nu se refera direct e cod mort, si
# o sterge sau ii schimba numele. Rezultatul ar fi fost o aplicatie care
# porneste, dar in care nicio analiza nativa nu mai raspunde: exact bug-ul cu
# plugin-ul de segmentare neinregistrat, doar ca la scara, si numai in release.
# ─────────────────────────────────────────────────────────────────────────────

# Puntea Capacitor: clasele, adnotarile si metodele expuse catre JS.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep class * extends com.getcapacitor.Plugin { *; }

# Plugin-urile locale, pe nume: sunt instantiate prin registerPlugin(...) din
# MainActivity si apelate din JS dupa numele din @CapacitorPlugin.
-keep class com.luminculler.app.plugins.** { *; }
-keep class com.luminculler.app.MainActivity { *; }

# Cordova, cat timp puntea capacitor-cordova-android-plugins e in build.
-keep class org.apache.cordova.** { *; }

# ML Kit si MediaPipe isi incarca modelele si delegatii prin reflexie si JNI.
# Numele native trebuie sa ramana neschimbate, altfel legarea la .so pica in
# executie — si numai in release, unde e cel mai greu de prins.
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_** { *; }
-keep class com.google.mediapipe.** { *; }
-keep class com.google.protobuf.** { *; }
-keepclasseswithmembernames class * {
    native <methods>;
}

# Facturarea Google Play: raspunsurile vin deserializate prin reflexie.
-keep class com.android.billingclient.** { *; }

# Kotlin: metadatele si obiectele companion, folosite tot prin reflexie.
-keep class kotlin.Metadata { *; }
-keepclassmembers class ** { public static ** Companion; }

# Urmele de stiva raman citibile in rapoartele de crash din Play Console.
-keepattributes SourceFile,LineNumberTable,*Annotation*,Signature,Exceptions
-renamesourcefileattribute SourceFile

# R8 se plange de referinte lipsa din dependinte optionale pe care nu le
# folosim; nu sunt erori, doar cod pe care nimeni nu-l cheama.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn org.checkerframework.**
