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
# static INSTANCE. Scrisesem aici ca ar fi suspect pentru inchiderea fortata —
# nu era, cauza aceea s-a dovedit a fi reciclarea unui bitmap din cache. Regula
# ramane pentru ce chiar acopera: un camp static atins doar din Java, pe care
# R8 nu are de unde sa-l vada legat de restul.
-keep class com.luminculler.app.ModelRegistry { *; }
-keep class com.luminculler.app.ReleasableModel { *; }

# ─────────────────────────────────────────────────────────────────────────────
# Ce s-a scos de aici, si de ce. Masurat, nu presupus.
#
# Raportul R8 al unui release real (mapping.txt, 11441 de clase) arata ca doar
# 20% dintre clase ajungeau redenumite. Cauza nu era R8, ci regulile astea:
# 9156 de clase ramaneau neatinse, si 8961 dintre ele erau tinute de `-keep`-uri
# scrise chiar aici. Pragul de calitate Play cere optimizare, deci regulile mele
# submineaza fix motivul pentru care am pornit R8.
#
# Am deschis apoi `configuration.txt` din acelasi raport, care listeaza TOATE
# regulile puse cap la cap, cu fisierul din care vine fiecare. De acolo se vede
# ce trimit bibliotecile singure, in AAR-urile lor:
#
#   ML Kit (face-detection, text-recognition, genai-image-description,
#   vision-internal-vkp, common) — trimit reguli tintite: `native <methods>`,
#   campurile claselor de protobuf, si tot ce e adnotat @UsedByReflection.
#   Exact ce aveam eu, doar ca la obiect. `-keep class com.google.mlkit.**` si
#   `com.google.android.gms.internal.mlkit_**` tineau 7293 de clase degeaba.
#
#   Play Billing — isi trimite propriile reguli, inclusiv `-keepnames` pentru
#   cele doua ProxyBillingActivity, singurele care chiar au nevoie. Regula mea
#   tinea 271 de clase peste ele.
#
#   Capacitor — trimite `-keep public class * extends org.apache.cordova.*`,
#   deci puntea Cordova e deja acoperita. Regula mea mai tinea 96 de clase.
#
# Ce a RAMAS, si de ce nu se scoate: MediaPipe si protobuf-ul lui NU apar deloc
# in lista de mai sus — nu trimit nicio regula de pastrare. Iar MediaPipe cheama
# inapoi in Java din codul nativ, pe nume. Fara `-keep` aici, legarea la .so
# pica in executie, si numai in release. 1221 de clase tinute pentru asta e un
# pret pe care il platesc.
# ─────────────────────────────────────────────────────────────────────────────

# MediaPipe si protobuf: JNI cheama inapoi pe nume, si nu vin cu reguli proprii.
-keep class com.google.mediapipe.** { *; }
-keep class com.google.protobuf.** { *; }

# Metodele native, oriunde ar fi: numele lor E contractul cu .so-ul.
-keepclasseswithmembernames class * {
    native <methods>;
}

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
