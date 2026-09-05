package com.atatusoft.ppphp

import com.intellij.platform.lsp.api.LspServer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import org.eclipse.lsp4j.CodeAction
import org.eclipse.lsp4j.WorkspaceEdit
import java.lang.reflect.Proxy

class PpphpImportIntentionTest : BasePlatformTestCase() {
    fun testNativeActionAvailabilityDoesNotSendRequestsAndRejectsStaleVersions() {
        val file = myFixture.configureByText(PpphpFileType.INSTANCE, "<?php DemoRunner::create();")
        var version = 7
        val server = Proxy.newProxyInstance(javaClass.classLoader, arrayOf(LspServer::class.java)) { _, method, _ ->
            when (method.name) {
                "getProject" -> project
                "getDocumentVersion" -> version
                else -> error("Availability must not call ${method.name}")
            }
        } as LspServer
        val action = CodeAction("Import class").apply {
            edit = WorkspaceEdit(emptyMap())
            data = mapOf("ppphp" to mapOf("kind" to "importChoices", "version" to 7))
        }
        val intention = PpphpCodeActionsSupport().createIntentionAction(server, action)

        assertEquals("Import class", intention.text)
        assertFalse(intention.startInWriteAction())
        assertTrue(intention.isAvailable(project, myFixture.editor, file))
        version++
        assertFalse(intention.isAvailable(project, myFixture.editor, file))
    }

    fun testCreateClassDialogIsPrefilledWithoutCreatingAFile() {
        val directory = myFixture.tempDirFixture.findOrCreateDir("app")
        val psiDirectory = com.intellij.psi.PsiManager.getInstance(project).findDirectory(directory)!!
        val dialog = PpphpCreateClassDialog(project, psiDirectory,
            PpphpComposerNamespaceResolver.Resolution.NONE, PpphpKnownTypeCatalog.EMPTY,
            "DemoRunner", "App")
        try {
            assertEquals("DemoRunner", dialog.specification.typeName)
            assertEquals("DemoRunner", dialog.specification.fileBaseName)
            assertEquals("App", dialog.specification.namespace)
            assertNull(psiDirectory.findFile("DemoRunner.ppphp"))
        } finally {
            dialog.close(0)
        }
    }
}
