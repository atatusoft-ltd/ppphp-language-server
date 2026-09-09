package com.atatusoft.ppphp

import com.intellij.openapi.options.ConfigurationException
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.project.Project
import java.awt.BorderLayout
import java.awt.FlowLayout
import java.text.ParseException
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JSpinner
import javax.swing.SpinnerNumberModel

class PpphpCompilerConfigurable(private val project: Project) : SearchableConfigurable {
    internal var memoryLimit: JSpinner? = null
        private set

    override fun getId(): String = "ppphp.compiler"
    override fun getDisplayName(): String = "++PHP"

    override fun createComponent(): JComponent {
        val spinner = JSpinner(
            SpinnerNumberModel(PpphpCompilerSettings.getInstance(project).memoryLimitMegabytes, 1, Int.MAX_VALUE, 64),
        )
        memoryLimit = spinner
        val label = JLabel("Compiler memory limit (MiB):").apply { labelFor = spinner }
        return JPanel(BorderLayout()).apply {
            add(
                JPanel(FlowLayout(FlowLayout.LEFT)).apply {
                    add(label)
                    add(spinner)
                },
                BorderLayout.NORTH,
            )
            add(
                JLabel("Applies to each compiler process. Saving restarts ++PHP analysis; php.ini is unchanged."),
                BorderLayout.CENTER,
            )
        }
    }

    override fun isModified(): Boolean {
        val spinner = memoryLimit ?: return false
        val field = (spinner.editor as JSpinner.DefaultEditor).textField
        // Include text that has not lost focus yet, so Apply is enabled while typing.
        val savedLimit = PpphpCompilerSettings.getInstance(project).memoryLimitMegabytes
        return field.text != field.formatter.valueToString(savedLimit)
    }

    override fun apply() {
        val spinner = memoryLimit ?: return
        try {
            spinner.commitEdit()
        } catch (_: ParseException) {
            throw ConfigurationException("Enter a positive whole number of MiB.")
        }
        val limit = (spinner.value as Number).toInt()
        if (limit <= 0) throw ConfigurationException("Enter a positive whole number of MiB.")
        PpphpCompilerSettings.getInstance(project).update(project, limit)
    }

    override fun reset() {
        memoryLimit?.value = PpphpCompilerSettings.getInstance(project).memoryLimitMegabytes
    }

    override fun disposeUIResources() {
        memoryLimit = null
    }
}
