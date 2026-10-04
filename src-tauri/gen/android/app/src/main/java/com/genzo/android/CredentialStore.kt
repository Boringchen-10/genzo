package com.genzo.android

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// The Keystore owns the key; only authenticated ciphertext is stored in app-private preferences.
class CredentialStore(context: Context) {
    private val preferences = context.getSharedPreferences("genzo-encrypted-credentials", 0)
    private val alias = "Genzo.WebDAV.AESGCM.v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build())
        }.generateKey()
    }
    @Synchronized
    fun save(id: String, username: String, password: String) {
        val clear = JSONObject().put("username", username).put("password", password).toString().toByteArray(Charsets.UTF_8)
        require(clear.size <= 16384)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()); updateAAD(id.toByteArray()) }
            val encrypted = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .put("ciphertext", Base64.encodeToString(cipher.doFinal(clear), Base64.NO_WRAP)).toString()
            check(preferences.edit().putString(id, encrypted).commit())
        } finally { clear.fill(0) }
    }
    @Synchronized
    fun read(id: String): JSONObject {
        val record = JSONObject(preferences.getString(id, null) ?: throw IllegalStateException("Credential missing"))
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(record.getString("iv"), Base64.NO_WRAP)))
            updateAAD(id.toByteArray())
        }
        val clear = cipher.doFinal(Base64.decode(record.getString("ciphertext"), Base64.NO_WRAP))
        try { return JSONObject(String(clear, Charsets.UTF_8)) } finally { clear.fill(0) }
    }
    fun delete(id: String) { check(preferences.edit().remove(id).commit()) }
}
