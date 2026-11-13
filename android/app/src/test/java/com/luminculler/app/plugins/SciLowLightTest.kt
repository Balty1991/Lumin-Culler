package com.luminculler.app.plugins

import org.junit.Assert.assertEquals
import org.junit.Test

/** Aceleași numere ca implementarea de referință (model.py din SCI, rulat cu greutățile medium). */
class SciLowLightTest {
    @Test
    fun matchesReference() {
        val x = floatArrayOf(0.0000023f, 0.0394613f, 0.2266816f, 0.137595f, 0.1598302f, 0.0656878f, 0.0141134f, 0.2036594f, 0.2037889f, 0.2804079f, 0.1150506f, 0.1558249f, 0.2492896f, 0.0103716f, 0.0160385f, 0.1589101f, 0.2013448f, 0.0023095f, 0.1150247f, 0.0200527f, 0.1252458f, 0.2060318f, 0.176693f, 0.2791309f, 0.2538501f, 0.1580786f, 0.0275895f, 0.1961757f, 0.1247998f, 0.2103572f, 0.2730962f, 0.2286594f, 0.0787359f, 0.0142394f, 0.2208246f, 0.0984703f, 0.1897916f, 0.2269231f, 0.2973112f, 0.1096016f, 0.0741117f, 0.2947651f, 0.2167981f, 0.2260068f, 0.1954556f, 0.0218058f, 0.1894904f, 0.2654121f)
        val want = floatArrayOf(0.0000107f, 0.1210138f, 0.7321837f, 0.2608514f, 0.3388691f, 0.2575508f, 0.0690581f, 0.4016703f, 0.3750785f, 0.7667254f, 0.5834354f, 0.3583214f, 0.3655242f, 0.0576348f, 0.0816598f, 0.6043482f, 0.4579204f, 0.0089285f, 0.344556f, 0.0402019f, 0.6150026f, 0.7748156f, 0.6893547f, 0.4513556f, 0.7421228f, 0.6009171f, 0.1297356f, 0.2899781f, 0.454487f, 0.7371363f, 0.8981431f, 0.4943368f, 0.1428814f, 0.0306882f, 0.5075894f, 0.3074576f, 0.4869388f, 0.7888658f, 0.9041375f, 0.5157951f, 0.2544656f, 0.9007571f, 0.7865356f, 0.7473987f, 0.5533307f, 0.1628109f, 0.8028478f, 0.6420665f)
        val got = SciLowLight.enhance(x, 4, 4)
        for (i in want.indices) assertEquals("pixel $i", want[i], got[i], 2e-3f)
    }

    @Test
    fun brightensDarkKeepsBright() {
        val dark = SciLowLight.enhance(FloatArray(3 * 8 * 8) { 0.08f }, 8, 8)
        val bright = SciLowLight.enhance(FloatArray(3 * 8 * 8) { 0.8f }, 8, 8)
        assert(dark[4 * 8 + 4] > 0.3f)
        assert(bright[4 * 8 + 4] in 0.8f..1f)
    }
}
