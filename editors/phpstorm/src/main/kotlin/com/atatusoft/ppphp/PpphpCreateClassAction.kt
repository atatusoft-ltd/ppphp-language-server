package com.atatusoft.ppphp

import com.intellij.application.options.CodeStyle
import com.intellij.icons.AllIcons
import com.intellij.ide.actions.CreateFileFromTemplateAction
import com.intellij.ide.fileTemplates.FileTemplateManager
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.LangDataKeys
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.psi.PsiDirectory
import com.intellij.psi.PsiFile
import com.intellij.psi.codeStyle.CommonCodeStyleSettings
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.TitledSeparator
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextField
import com.intellij.util.IncorrectOperationException
import com.intellij.util.PathUtilRt
import com.jetbrains.php.lang.PhpLangUtil
import com.jetbrains.php.roots.PhpNamespaceCompositeProvider
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets
import javax.swing.DefaultListModel
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JComboBox
import javax.swing.JPanel
import javax.swing.ListSelectionModel
import javax.swing.event.DocumentEvent

class PpphpCreateClassAction : DumbAwareAction(
    "++PHP Class",
    "Create a ++PHP class, interface, trait, or enum",
    PpphpIcons.FILE,
) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabledAndVisible =
            event.project != null && event.getData(LangDataKeys.IDE_VIEW) != null
    }

    override fun actionPerformed(event: AnActionEvent) {
        val project = event.project ?: return
        val view = event.getData(LangDataKeys.IDE_VIEW) ?: return
        val directory = view.orChooseDirectory ?: return
        val dialog = PpphpCreateClassDialog(project, directory)
        if (!dialog.showAndGet()) return

        try {
            val specification = dialog.specification
            val created = WriteCommandAction.writeCommandAction(project)
                .withName(
                    "Create ++PHP ${specification.template.displayName.lowercase()} " +
                        specification.typeName,
                )
                .compute<PsiFile?, RuntimeException> {
                    PpphpDeclarationCreator.create(project, directory, specification)
                }
            created?.let(view::selectElement)
        } catch (error: IncorrectOperationException) {
            Messages.showErrorDialog(
                project,
                error.message ?: "The ++PHP declaration could not be created.",
                "Cannot Create ++PHP Declaration",
            )
        }
    }
}

internal object PpphpDeclarationCreator {
    fun create(
        project: Project,
        directory: PsiDirectory,
        specification: PpphpDeclarationSpecification,
    ): PsiFile? {
        val template = FileTemplateManager.getInstance(project)
            .getInternalTemplate(specification.template.fileTemplateName)
        return CreateFileFromTemplateAction.createFileFromTemplate(
            specification.fileBaseName,
            template,
            directory,
            null,
            true,
            emptyMap(),
            specification.templateProperties() +
                PpphpDeclarationCodeStyle.templateProperties(project),
        )
    }
}

internal object PpphpDeclarationCodeStyle {
    fun templateProperties(project: Project): Map<String, String> {
        val settings = CodeStyle.getSettings(project)
        val common = settings.getCommonSettings(PpphpLanguage.INSTANCE)
        val indentOptions = settings.getLanguageIndentOptions(PpphpLanguage.INSTANCE)
        val indent = if (indentOptions.USE_TAB_CHARACTER) {
            "\t"
        } else {
            " ".repeat(indentOptions.INDENT_SIZE.coerceAtLeast(0))
        }
        val braces = when (common.CLASS_BRACE_STYLE) {
            CommonCodeStyleSettings.END_OF_LINE -> DeclarationBraces(
                opening = if (common.SPACE_BEFORE_CLASS_LBRACE) " {" else "{",
                closing = "}",
            )

            CommonCodeStyleSettings.NEXT_LINE_IF_WRAPPED ->
                DeclarationBraces(opening = "\n{", closing = "}")

            CommonCodeStyleSettings.NEXT_LINE_SHIFTED,
            CommonCodeStyleSettings.NEXT_LINE_SHIFTED2,
            -> DeclarationBraces(opening = "\n$indent{", closing = "$indent}")

            else -> DeclarationBraces(opening = "\n{", closing = "}")
        }
        return mapOf(
            "DECLARATION_LBRACE" to braces.opening,
            "DECLARATION_RBRACE" to braces.closing,
        )
    }

    private data class DeclarationBraces(val opening: String, val closing: String)
}

internal enum class PpphpDeclarationTemplate(
    val displayName: String,
    val fileTemplateName: String,
    val supportsParentClass: Boolean,
    val relatedTypesKeyword: String?,
    val supportsBackedType: Boolean,
) {
    CLASS("Class", "++PHP Class", true, "implements", false),
    INTERFACE("Interface", "++PHP Interface", false, "extends", false),
    TRAIT("Trait", "++PHP Trait", false, null, false),
    ENUM("Enum", "++PHP Enum", false, "implements", true),
    ;

    override fun toString(): String = displayName
}

internal data class PpphpDeclarationSpecification(
    val typeName: String,
    val fileBaseName: String,
    val namespace: String,
    val template: PpphpDeclarationTemplate,
    val parentClass: String = "",
    val relatedTypes: List<String> = emptyList(),
    val backedType: String = "",
) {
    fun templateProperties(): Map<String, String> = mapOf(
        "NAME" to typeName,
        "NAMESPACE" to namespace,
        "INHERITANCE" to inheritanceClause(),
        "BACKED_TYPE" to backedTypeClause(),
    )

    private fun inheritanceClause(): String = buildString {
        if (template.supportsParentClass && parentClass.isNotBlank()) {
            append(" extends ").append(parentClass.trim())
        }
        template.relatedTypesKeyword?.takeIf { relatedTypes.isNotEmpty() }?.let { keyword ->
            append(' ').append(keyword).append(' ')
            append(relatedTypes.joinToString(", ") { it.trim() })
        }
    }

    private fun backedTypeClause(): String =
        if (template.supportsBackedType && backedType.isNotBlank()) {
            " : ${backedType.trim()}"
        } else {
            ""
        }
}

internal object PpphpPhpNames {
    fun isValidTypeName(value: String): Boolean =
        PhpLangUtil.isPhpIdentifier(value) &&
            !PhpLangUtil.isPhpReservedKeyword(value) &&
            !PhpLangUtil.isPhpReservedClassName(value)

    fun isValidNamespace(value: String): Boolean {
        val normalized = value.trim().trim('\u005c')
        return normalized.isEmpty() || normalized.split('\u005c').all(::isValidNamespaceSegment)
    }

    fun isValidQualifiedType(value: String): Boolean {
        val normalized = value.trim().trimStart('\u005c')
        if (normalized.isEmpty()) return false
        val segments = normalized.split('\u005c')
        return segments.dropLast(1).all(::isValidNamespaceSegment) &&
            isValidTypeName(segments.last())
    }

    private fun isValidNamespaceSegment(value: String): Boolean =
        PhpLangUtil.isPhpIdentifier(value) && !PhpLangUtil.isPhpReservedKeyword(value)
}

private class PpphpCreateClassDialog(
    private val project: Project,
    private val directory: PsiDirectory,
) : DialogWrapper(project, true) {
    private val typeNameField = JBTextField(42)
    private val namespaceField = JComboBox(
        PhpNamespaceCompositeProvider.INSTANCE
            .suggestNamespaces(directory)
            .map { it.trim().trim('\u005c') }
            .distinct()
            .toTypedArray(),
    ).apply {
        isEditable = true
    }
    private val fileNameField = JBTextField(42)
    private val directoryField = JBTextField(directory.virtualFile.presentableUrl, 42)
    private val templateSelector = JComboBox(PpphpDeclarationTemplate.entries.toTypedArray())
    private val parentClassField = JBTextField(42)
    private val relatedTypesLabel = JBLabel("Implements:")
    private val relatedTypesModel = DefaultListModel<String>()
    private val relatedTypesList = JBList(relatedTypesModel)
    private val addRelatedTypeButton = JButton(AllIcons.General.Add)
    private val removeRelatedTypeButton = JButton(AllIcons.General.Remove)
    private val backedTypeSelector = JComboBox(arrayOf("None", "string", "int"))
    private var updatingFileName = false
    private var fileNameWasEdited = false

    val specification: PpphpDeclarationSpecification
        get() = PpphpDeclarationSpecification(
            typeName = typeName,
            fileBaseName = fileBaseName,
            namespace = namespace,
            template = template,
            parentClass = parentClassField.text,
            relatedTypes = relatedTypes(),
            backedType = backedTypeSelector.selectedItem?.toString().orEmpty().takeUnless {
                it == "None"
            }.orEmpty(),
        )

    private val typeName: String
        get() = typeNameField.text.trim()

    private val template: PpphpDeclarationTemplate
        get() = templateSelector.selectedItem as? PpphpDeclarationTemplate
            ?: PpphpDeclarationTemplate.CLASS

    private val fileBaseName: String
        get() = fileNameField.text.trim().removeSuffix(".ppphp")

    private val namespace: String
        get() = namespaceField.editor.item?.toString()?.trim()?.trim('\u005c').orEmpty()

    init {
        title = "Create New ++PHP Class"
        setOKButtonText("OK")
        directoryField.isEditable = false
        typeNameField.emptyText.text = "Type name"
        namespaceField.toolTipText = "Namespace suggested from PhpStorm's PHP and Composer project model"
        fileNameField.emptyText.text = "TypeName.ppphp"
        parentClassField.emptyText.text = "Optional parent class"
        relatedTypesList.emptyText.text = "Choose interfaces to implement"
        relatedTypesList.selectionMode = ListSelectionModel.SINGLE_SELECTION
        relatedTypesList.addListSelectionListener {
            removeRelatedTypeButton.isEnabled = relatedTypesList.selectedIndex >= 0
        }
        addRelatedTypeButton.toolTipText = "Add related type"
        addRelatedTypeButton.accessibleContext.accessibleName = "Add related type"
        addRelatedTypeButton.addActionListener { addRelatedType() }
        removeRelatedTypeButton.toolTipText = "Remove selected type"
        removeRelatedTypeButton.accessibleContext.accessibleName = "Remove selected type"
        removeRelatedTypeButton.isEnabled = false
        removeRelatedTypeButton.addActionListener { removeSelectedRelatedType() }
        templateSelector.addActionListener { updateTemplateControls() }
        installFileNameSynchronization()
        updateTemplateControls()
        init()
    }

    override fun createCenterPanel(): JComponent = JPanel(GridBagLayout()).apply {
        addSection(this, 0, "PHP declaration")
        addRow(this, 1, "Name:", typeNameField)
        addRow(this, 2, "Namespace:", namespaceField)
        addRow(this, 3, "File name:", fileNameField)
        addRow(this, 4, "Directory:", directoryField)
        addRow(this, 5, "Template:", templateSelector)
        addRow(this, 6, "Backed type:", backedTypeSelector)
        addSection(this, 7, "Parent types")
        addRow(this, 8, "Extends:", parentClassField)

        add(
            relatedTypesLabel,
            GridBagConstraints().apply {
                gridx = 0
                gridy = 9
                anchor = GridBagConstraints.FIRST_LINE_START
                insets = Insets(8, 20, 4, 12)
            },
        )
        add(
            relatedTypesPanel(),
            GridBagConstraints().apply {
                gridx = 1
                gridy = 9
                weightx = 1.0
                weighty = 1.0
                fill = GridBagConstraints.BOTH
                insets = Insets(4, 0, 4, 0)
            },
        )
    }

    override fun getPreferredFocusedComponent(): JComponent = typeNameField

    override fun getInitialSize(): Dimension = Dimension(720, 560)

    override fun doValidate(): ValidationInfo? {
        if (!PpphpPhpNames.isValidTypeName(typeName)) {
            return ValidationInfo("Enter a valid PHP type name.", typeNameField)
        }
        if (fileBaseName.isEmpty() || !PathUtilRt.isValidFileName("$fileBaseName.ppphp", true)) {
            return ValidationInfo("Enter a valid ++PHP file name.", fileNameField)
        }
        if (directory.findFile("$fileBaseName.ppphp") != null) {
            return ValidationInfo("$fileBaseName.ppphp already exists.", fileNameField)
        }
        if (!PpphpPhpNames.isValidNamespace(namespace)) {
            return ValidationInfo("Enter a valid PHP namespace.", namespaceField)
        }
        if (
            template.supportsParentClass &&
            parentClassField.text.isNotBlank() &&
            !PpphpPhpNames.isValidQualifiedType(parentClassField.text)
        ) {
            return ValidationInfo("Enter one valid PHP parent class.", parentClassField)
        }
        return null
    }

    private fun updateTemplateControls() {
        parentClassField.isEnabled = template.supportsParentClass
        if (!template.supportsParentClass) parentClassField.text = ""

        backedTypeSelector.isEnabled = template.supportsBackedType
        if (!template.supportsBackedType) backedTypeSelector.selectedItem = "None"

        val relatedTypesEnabled = template.relatedTypesKeyword != null
        relatedTypesList.isEnabled = relatedTypesEnabled
        addRelatedTypeButton.isEnabled = relatedTypesEnabled
        removeRelatedTypeButton.isEnabled =
            relatedTypesEnabled && relatedTypesList.selectedIndex >= 0
        relatedTypesLabel.text = when (template.relatedTypesKeyword) {
            "extends" -> "Extends:"
            "implements" -> "Implements:"
            else -> "Related types:"
        }
        relatedTypesList.emptyText.text = when (template.relatedTypesKeyword) {
            "extends" -> "Choose parent interfaces"
            "implements" -> "Choose interfaces to implement"
            else -> "Not available for this declaration"
        }
    }

    private fun installFileNameSynchronization() {
        typeNameField.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(event: DocumentEvent) {
                if (fileNameWasEdited) return
                updatingFileName = true
                val name = typeNameField.text.trim()
                fileNameField.text = if (name.isEmpty()) "" else "$name.ppphp"
                updatingFileName = false
            }
        })
        fileNameField.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(event: DocumentEvent) {
                if (!updatingFileName) fileNameWasEdited = true
            }
        })
    }

    private fun addRelatedType() {
        val label = if (template.relatedTypesKeyword == "extends") "Parent interface" else "Interface"
        val relatedType = Messages.showInputDialog(
            project,
            "$label name:",
            "Add PHP Type",
            PpphpIcons.FILE,
        )?.trim() ?: return
        if (!PpphpPhpNames.isValidQualifiedType(relatedType)) {
            Messages.showErrorDialog(project, "Enter a valid PHP type name.", "Invalid Type")
            return
        }
        if (relatedTypes().contains(relatedType)) {
            Messages.showErrorDialog(project, "$relatedType is already selected.", "Duplicate Type")
            return
        }
        relatedTypesModel.addElement(relatedType)
        relatedTypesList.selectedIndex = relatedTypesModel.size() - 1
    }

    private fun removeSelectedRelatedType() {
        val index = relatedTypesList.selectedIndex
        if (index >= 0) relatedTypesModel.remove(index)
    }

    private fun relatedTypes(): List<String> =
        (0 until relatedTypesModel.size()).map(relatedTypesModel::getElementAt)

    private fun relatedTypesPanel(): JComponent = JPanel(BorderLayout(0, 4)).apply {
        add(
            JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
                add(addRelatedTypeButton)
                add(removeRelatedTypeButton)
            },
            BorderLayout.NORTH,
        )
        add(JBScrollPane(relatedTypesList), BorderLayout.CENTER)
    }

    private fun addSection(panel: JPanel, row: Int, title: String) {
        panel.add(
            TitledSeparator(title),
            GridBagConstraints().apply {
                gridx = 0
                gridy = row
                gridwidth = 2
                weightx = 1.0
                fill = GridBagConstraints.HORIZONTAL
                insets = Insets(if (row == 0) 0 else 12, 0, 4, 0)
            },
        )
    }

    private fun addRow(panel: JPanel, row: Int, label: String, field: JComponent) {
        panel.add(
            JBLabel(label),
            GridBagConstraints().apply {
                gridx = 0
                gridy = row
                anchor = GridBagConstraints.LINE_START
                insets = Insets(4, 20, 4, 12)
            },
        )
        panel.add(
            field,
            GridBagConstraints().apply {
                gridx = 1
                gridy = row
                weightx = 1.0
                fill = GridBagConstraints.HORIZONTAL
                insets = Insets(4, 0, 4, 0)
            },
        )
    }
}
