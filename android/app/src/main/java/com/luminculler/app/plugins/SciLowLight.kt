package com.luminculler.app.plugins

import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

/**
 * Lumina pentru pozele întunecate: rețeaua de iluminare SCI (Ma et al., „Toward Fast, Flexible,
 * and Robust Low-Light Image Enhancement”, CVPR 2022), greutățile „medium” din depozitul
 * oficial vis-opt-group/SCI, licență MIT (Copyright (c) 2022 Tengyu Ma).
 *
 * E atât de mică (3 convoluții 3×3 pe 3 canale, ~270 de numere) încât stă aici, fără fișier
 * de model. BatchNorm e contopit în convoluția din bloc. Drumul, exact ca în model.py:
 *   f1 = ReLU(conv_in(x)); f2 = f1 + ReLU(bn(conv(f1))); o = σ(conv_out(f2));
 *   lumina = clamp(o + x, 1e-4, 1); rezultatul = clamp(x / lumina, 0, 1).
 * Înlocuiește Zero-DCE (doar necomercial, CC BY-NC 4.0).
 */
object SciLowLight {
    private val IN_W = floatArrayOf(0.079974f, -0.017348f, -0.007018f, -0.007116f, 0.011722f, 0.04646f, -0.013243f, -0.046154f, 0.000197f, 0.063798f, -0.025499f, 0.010378f, 0.008836f, 0.043063f, -0.064079f, 0.007641f, 0.033126f, 0.001946f, -0.099716f, 0.04705f, 0.033861f, 0.095516f, 0.108459f, 0.056438f, -0.013824f, -0.042735f, -0.002121f, -0.026047f, 0.03647f, 0.012141f, -0.013041f, -0.018705f, -0.095765f, -0.00362f, -0.012739f, -0.026618f, -0.014082f, 0.037176f, -0.001967f, -0.020612f, 0.13639f, 0.03404f, -0.009038f, 0.011313f, 0.032235f, 0.034366f, -0.053045f, -0.027149f, 0.003732f, 0.084762f, -0.067054f, -0.003357f, -0.009747f, -0.025064f, 0.008235f, 0.019058f, 0.005993f, -0.072223f, -0.048639f, -0.026998f, -0.027727f, -0.083603f, 0.061473f, 0.010299f, 0.016201f, 0.002974f, -0.035099f, -0.036304f, 0.012534f, -0.013296f, 0.120474f, -0.056826f, -0.00827f, -0.027161f, -0.001944f, 0.103056f, 0.019654f, 0.016416f, -0.017728f, -0.024286f, 0.05904f)
    private val IN_B = floatArrayOf(0.05846f, 0.06321f, 0.040016f)
    private val BLK_W = floatArrayOf(-0.0745678f, -0.5359359f, -2.4296395f, 4.0698127f, 6.7942328f, -0.5667149f, 11.7099928f, -13.7065047f, 23.7680742f, 2.1177241f, -3.0099987f, -2.7256893f, 26.433792f, -7.3314379f, 6.3769707f, 0.1034429f, -22.8700881f, -3.0017486f, 2.4083797f, 0.3163577f, 1.576394f, 20.1082255f, -40.4300003f, -33.5421612f, -0.1481836f, 8.9985824f, -7.6179684f, 2.6395557f, 3.060768f, 5.1194709f, -2.6304602f, -21.0305093f, 3.2574174f, 26.0838031f, 34.9461991f, -9.4589305f, 6.1544678f, 8.6246603f, 5.8994822f, 24.4190263f, 17.6539104f, -9.3513536f, 10.6930859f, 6.9410654f, 1.7507129f, -4.459582f, -14.623565f, -6.999088f, 30.7425436f, -18.6509574f, 12.2951356f, 4.991194f, 1.6152224f, 5.2602932f, -1.7433121f, -2.7589082f, -6.1710575f, 2.0215073f, 16.5865122f, -8.2740529f, 8.3949493f, 42.1624363f, -8.2787285f, -2.8611024f, -10.8903569f, -6.6673337f, 0.2023845f, -50.7617739f, 8.5151777f, 4.712954f, 27.5663724f, 0.9471328f, 5.1721597f, 12.9218832f, 11.3916426f, 14.6271229f, -4.681227f, 6.227832f, 6.3731081f, 0.5280031f, 4.8027913f)
    private val BLK_B = floatArrayOf(2.5738244f, -5.553441f, -0.7143727f)
    private val OUT_W = floatArrayOf(-0.103831f, -0.171564f, 0.017393f, -0.114399f, -0.185759f, -0.032276f, 0.014158f, 0.011014f, -0.038233f, 0.110862f, -0.149078f, 0.024178f, 0.137952f, 0.141437f, -0.096012f, -0.021904f, -0.104636f, -0.026577f, 0.047888f, 0.00625f, 0.020662f, -0.233335f, 0.064955f, -0.053897f, 0.045613f, 0.14228f, -0.027519f, -0.02539f, 0.22947f, -0.074414f, -0.102442f, -0.202166f, -0.123638f, -0.010608f, -0.006036f, -0.008965f, 0.019054f, 0.022104f, -0.121897f, 0.026559f, -0.047485f, -0.12722f, -0.014642f, -0.063818f, -0.033124f, 0.072369f, -0.145381f, -0.065308f, 0.012666f, 0.11488f, -0.001596f, 0.032764f, 0.07906f, 0.005657f, -0.052491f, 0.046681f, -0.029486f, -0.129384f, 0.112442f, -0.083727f, -0.029849f, -0.01971f, 0.026973f, 0.072228f, -0.157186f, -0.114381f, 0.127799f, -0.080574f, 0.017165f, 0.024977f, 0.083082f, -0.012406f, 0.034634f, -0.167078f, -0.067204f, -0.104756f, -0.011849f, 0.028397f, -0.039836f, -0.101801f, 0.037279f)
    private val OUT_B = floatArrayOf(-0.15804f, -0.268965f, -0.248723f)

    /** Convoluție 3×3, 3→3 canale, pas 1, margine de zerouri (ca în PyTorch). Planar: [c][y][x]. */
    private fun conv(x: FloatArray, h: Int, w: Int, wt: FloatArray, b: FloatArray): FloatArray {
        val out = FloatArray(3 * h * w)
        val plane = h * w
        for (o in 0 until 3) {
            val ob = o * plane
            for (y in 0 until h) for (xx in 0 until w) {
                var acc = b[o]
                for (i in 0 until 3) {
                    val ib = i * plane
                    val kb = (o * 3 + i) * 9
                    for (dy in 0 until 3) {
                        val yy = y + dy - 1
                        if (yy < 0 || yy >= h) continue
                        val row = ib + yy * w
                        for (dx in 0 until 3) {
                            val xq = xx + dx - 1
                            if (xq < 0 || xq >= w) continue
                            acc += wt[kb + dy * 3 + dx] * x[row + xq]
                        }
                    }
                }
                out[ob + y * w + xx] = acc
            }
        }
        return out
    }

    /** : RGB planar 0..1 (3·h·w). Întoarce poza luminată, la fel. */
    fun enhance(x: FloatArray, h: Int, w: Int): FloatArray {
        val f1 = conv(x, h, w, IN_W, IN_B)
        for (i in f1.indices) f1[i] = max(0f, f1[i])
        val f2 = conv(f1, h, w, BLK_W, BLK_B)
        for (i in f2.indices) f2[i] = f1[i] + max(0f, f2[i])
        val o = conv(f2, h, w, OUT_W, OUT_B)
        val r = FloatArray(x.size)
        for (i in x.indices) {
            val illu = min(1f, max(1e-4f, 1f / (1f + exp(-o[i])) + x[i]))
            r[i] = min(1f, max(0f, x[i] / illu))
        }
        return r
    }
}
