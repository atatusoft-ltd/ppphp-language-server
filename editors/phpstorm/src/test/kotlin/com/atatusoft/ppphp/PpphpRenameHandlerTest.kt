package com.atatusoft.ppphp

import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.refactoring.rename.RenameHandler
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.nio.file.Files

class PpphpRenameHandlerTest : BasePlatformTestCase() {
    fun testStandardRenameActionFindsThePpphpHandlerAtATypeName() {
        val file = myFixture.configureByText(
            PpphpFileType.INSTANCE,
            "<?php\nclass Trans<caret>action {}\n",
        )
        val registeredHandler = RenameHandler.EP_NAME.extensionList
            .filterIsInstance<PpphpRenameHandler>()
            .single()
        assertNotNull(registeredHandler)
        val handler = PpphpRenameHandler { _, _, _, _ -> true }
        val context = SimpleDataContext.builder()
            .add(CommonDataKeys.PROJECT, project)
            .add(CommonDataKeys.EDITOR, myFixture.editor)
            .add(CommonDataKeys.VIRTUAL_FILE, file.virtualFile)
            .add(CommonDataKeys.PSI_FILE, file)
            .build()

        assertTrue(handler.isAvailableOnDataContext(context))
    }

    fun testRenameAvailabilityRequiresSemanticTypePreparation() {
        val file = myFixture.configureByText(
            PpphpFileType.INSTANCE,
            "<?php\n${'$'}trans<caret>action = 'Transaction';\n",
        )
        val context = SimpleDataContext.builder()
            .add(CommonDataKeys.PROJECT, project)
            .add(CommonDataKeys.EDITOR, myFixture.editor)
            .add(CommonDataKeys.VIRTUAL_FILE, file.virtualFile)
            .add(CommonDataKeys.PSI_FILE, file)
            .build()

        assertFalse(PpphpRenameHandler { _, _, _, _ -> false }.isAvailableOnDataContext(context))
    }

    fun testIdentifierSelectionUsesEditorUtf16Offsets() {
        val source = "<?php\n${'$'}label = '😀';\nclass Transaction {}\n"
        val identifier = PpphpRenameSupport.findIdentifier(
            source,
            source.indexOf("Transaction") + 4,
        )

        assertEquals(
            PpphpIdentifier(
                "Transaction",
                source.indexOf("Transaction"),
                source.indexOf("Transaction") + "Transaction".length,
            ),
            identifier,
        )
    }

    fun testWorkspaceResponseMapsTextAndFileRenameOperations() {
        val source = "<?php\nclass Cart {}\n"
        val root = Files.createTempDirectory("ppphp-rename-response-")
        val sourcePath = root.resolve("Cart.ppphp")
        Files.writeString(sourcePath, source)
        val file = requireNotNull(LocalFileSystem.getInstance().refreshAndFindFileByNioFile(sourcePath))
        val oldUri = file.url
        val newUri = root.resolve("Basket.ppphp").toUri().toString()
        val response = """
            {
              "version": 1,
              "edit": {
                "documentChanges": [
                  {
                    "textDocument": {"uri": "$oldUri", "version": 1},
                    "edits": [
                      {
                        "range": {
                          "start": {"line": 1, "character": 6},
                          "end": {"line": 1, "character": 10}
                        },
                        "newText": "Basket"
                      }
                    ]
                  },
                  {
                    "kind": "rename",
                    "oldUri": "$oldUri",
                    "newUri": "$newUri"
                  }
                ]
              },
              "error": null
            }
        """.trimIndent()

        val rename = PpphpRenameSupport.parseResponse(response, root.toString())

        assertEquals(1, rename.textEdits.size)
        assertEquals(source.indexOf("Cart"), rename.textEdits.single().edits.single().start)
        assertEquals(source.indexOf("Cart") + "Cart".length, rename.textEdits.single().edits.single().end)
        assertEquals("Basket.ppphp", rename.fileRename?.newName)
    }
}
