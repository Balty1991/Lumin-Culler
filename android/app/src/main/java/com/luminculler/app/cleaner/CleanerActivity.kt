package com.luminculler.app.cleaner

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.google.android.play.core.review.ReviewManagerFactory
import com.luminculler.app.cleaner.ui.LuminApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/**
 * Lumin: teancul zilnic și curățenia galeriei, nativ. Uneltele de fotograf
 * (WebView-ul Capacitor, MainActivity) se deschid din Setări.
 *
 * Activitatea doar leagă modelul de lucrurile care cer o Activity: dialogul
 * de ștergere al sistemului, foaia de plată, permisiunile, recenzia.
 */
class CleanerActivity : ComponentActivity(), LuminHost {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var model: LuminModel
    private var deleteCallback: ((Boolean) -> Unit)? = null

    private val photosPermission = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        model.onPermissionsResult()
    }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private val deleteRequest = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
        val cb = deleteCallback
        deleteCallback = null
        cb?.invoke(result.resultCode == RESULT_OK)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        model = LuminModel(applicationContext, scope, this)
        setContent {
            LuminApp(model, onAllowPhotos = { photosPermission.launch(galleryPermissions()) })
        }
        model.start()
    }

    override fun onResume() {
        super.onResume()
        if (::model.isInitialized) model.onResume()
    }

    override fun onDestroy() {
        model.close()
        scope.cancel()
        super.onDestroy()
    }

    override fun launchDelete(step: DeleteStep.Confirm, onResult: (Boolean) -> Unit) {
        deleteCallback = onResult
        deleteRequest.launch(IntentSenderRequest.Builder(step.sender).build())
    }

    override fun launchPurchase(plan: PlanOffer): Boolean = model.billing.launch(this, plan)

    override fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun askReview() {
        val manager = ReviewManagerFactory.create(this)
        manager.requestReviewFlow().addOnCompleteListener { task ->
            if (task.isSuccessful && !isFinishing) manager.launchReviewFlow(this, task.result)
        }
    }

    override fun shareFreed(bytes: Long) = shareFreedCard(this, bytes)
}
