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
# ModelRegistry e un `object` Kotlin chemat din Java ca `ModelRegistry.INSTANCE`
# (vezi onTrimMemory in MainActivity). Interoperarea aceea trece prin campul
# static INSTANCE, exact genul de lucru pe care optimizarile de singleton il
# rescriu — si e printre suspectii pentru inchiderea fortata la pornire.
# Se pastreaza explicit, indiferent ce mai face R8.
-keep class com.luminculler.app.ModelRegistry { *; }
-keep class com.luminculler.app.ReleasableModel { *; }

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

# ─────────────────────────────────────────────────────────────────────────────
# CLASE LA CARE SE REFERA CINEVA, DAR CARE NU EXISTA IN PACHET
#
# R8 opreste buildul cand gaseste o referinta catre o clasa absenta — pe drept,
# fiindca de obicei inseamna o dependinta uitata. Aici insa sunt referinte care
# n-au cum sa fie apelate, iar `-keep` nu le rezolva: `-keep` pastreaza ce
# EXISTA, si astea chiar lipsesc din artefact.
#
# Fiecare linie de mai jos vine dintr-o eroare reala de build, nu dintr-o lista
# copiata de undeva:
#
#  - com.google.auto.value.extension.memoized.Memoized — o adnotare AutoValue,
#    procesata la COMPILARE si nepastrata in bytecode. MPImageProperties.hashCode()
#    o poarta ca urma. Nu exista la rulare, la nimeni.
#  - com.google.mediapipe.proto.CalculatorProfileProto / GraphTemplateProto —
#    protobuf-urile de profilare si de sabloane de graf. Nu vin in tasks-vision,
#    si sunt atinse doar de GraphProfiler.getCalculatorProfiles() si
#    Graph.loadBinaryGraphTemplate(), pe care aplicatia asta nu le cheama
#    niciodata: noi folosim doar ImageSegmenter/FaceLandmarker/PoseLandmarker.
#
# Restul (errorprone, javax.annotation, checkerframework) sunt adnotari de
# analiza statica, tot compile-time.
-dontwarn com.google.auto.value.**
-dontwarn com.google.mediapipe.proto.**
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn org.checkerframework.**
