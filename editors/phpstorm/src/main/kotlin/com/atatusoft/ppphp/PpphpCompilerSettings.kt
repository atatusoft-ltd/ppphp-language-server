package com.atatusoft.ppphp

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.project.Project
import com.intellij.util.messages.Topic

@Service(Service.Level.PROJECT)
@State(name = "PpphpCompilerSettings", storages = [Storage("ppphp.xml")])
class PpphpCompilerSettings : PersistentStateComponent<PpphpCompilerSettings.Values> {
    class Values {
        var memoryLimitMegabytes: Int = DEFAULT_MEMORY_LIMIT
    }

    private var values = Values()
    val memoryLimitMegabytes: Int get() = values.memoryLimitMegabytes.takeIf { it > 0 } ?: DEFAULT_MEMORY_LIMIT

    override fun getState(): Values = values
    override fun loadState(state: Values) {
        values = Values().apply {
            memoryLimitMegabytes = state.memoryLimitMegabytes.takeIf { it > 0 } ?: DEFAULT_MEMORY_LIMIT
        }
    }

    fun update(project: Project, limit: Int) {
        require(limit > 0)
        if (memoryLimitMegabytes == limit) return
        values.memoryLimitMegabytes = limit
        project.messageBus.syncPublisher(PpphpCompilerSettingsListener.TOPIC).settingsChanged()
    }

    companion object {
        const val DEFAULT_MEMORY_LIMIT = 512
        const val MEMORY_ENVIRONMENT_VARIABLE = "PPPHP_COMPILER_MEMORY_LIMIT_MEGABYTES"
        fun getInstance(project: Project): PpphpCompilerSettings = project.getService(PpphpCompilerSettings::class.java)
    }
}

interface PpphpCompilerSettingsListener {
    fun settingsChanged()
    companion object {
        @JvmField
        val TOPIC: Topic<PpphpCompilerSettingsListener> = Topic.create("++PHP compiler settings", PpphpCompilerSettingsListener::class.java)
    }
}
