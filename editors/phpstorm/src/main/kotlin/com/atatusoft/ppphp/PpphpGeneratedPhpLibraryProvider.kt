package com.atatusoft.ppphp

import com.google.gson.JsonObject
import com.google.gson.JsonParseException
import com.google.gson.JsonParser
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.roots.AdditionalLibraryRootsProvider
import com.intellij.openapi.roots.SyntheticLibrary
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import java.io.IOException
import java.util.ArrayDeque

class PpphpGeneratedPhpLibraryProvider : AdditionalLibraryRootsProvider() {
    override fun getAdditionalProjectLibraries(project: Project): Collection<SyntheticLibrary> =
        PpphpGeneratedPhpLibrary.resolve(PpphpProjectConfiguration.outputDirectory(project))
            ?.let(::listOf)
            ?: emptyList()

    override fun getRootsToWatch(project: Project): Collection<VirtualFile> =
        listOfNotNull(project.guessProjectDir(), PpphpProjectConfiguration.outputDirectory(project))
}

internal class PpphpGeneratedPhpLibrary private constructor(
    private val outputRoot: VirtualFile,
    private val includedUrls: Set<String>,
    private val excludedRoots: Set<VirtualFile>,
) : SyntheticLibrary() {
    override fun getSourceRoots(): Collection<VirtualFile> = listOf(outputRoot)

    override fun getExcludedRoots(): Set<VirtualFile> = excludedRoots

    override fun equals(other: Any?): Boolean =
        other is PpphpGeneratedPhpLibrary &&
            outputRoot.url == other.outputRoot.url &&
            includedUrls == other.includedUrls

    override fun hashCode(): Int = 31 * outputRoot.url.hashCode() + includedUrls.hashCode()

    companion object {
        private const val MANIFEST_PATH = ".ppphp/manifest.json"
        private const val MAXIMUM_MANIFEST_BYTES = 16L * 1024L * 1024L
        private const val MAXIMUM_FILE_ENTRIES = 50_000

        fun resolve(outputRoot: VirtualFile?): PpphpGeneratedPhpLibrary? {
            if (outputRoot == null || !outputRoot.isValid || !outputRoot.isDirectory) return null
            val manifest = outputRoot.findFileByRelativePath(MANIFEST_PATH)
                ?.takeIf { file -> file.isValid && !file.isDirectory }
                ?: return null
            if (manifest.length !in 1..MAXIMUM_MANIFEST_BYTES) return null

            val document = try {
                JsonParser.parseString(VfsUtilCore.loadText(manifest))
            } catch (_: JsonParseException) {
                return null
            } catch (_: IOException) {
                return null
            } catch (_: RuntimeException) {
                return null
            }
            if (!document.isJsonObject) return null
            val root = document.asJsonObject
            if (root.integer("formatVersion") != 2) return null
            val files = root.get("files")?.takeIf { it.isJsonArray }?.asJsonArray ?: return null
            if (files.size() > MAXIMUM_FILE_ENTRIES) return null

            val included = linkedSetOf(outputRoot.url)
            for (entryValue in files) {
                val entry = entryValue.takeIf { it.isJsonObject }?.asJsonObject ?: return null
                val sourceKind = entry.string("sourceKind") ?: return null
                val operation = entry.string("operation") ?: return null
                val output = entry.string("output")?.takeIf(::isSafeRelativePhpPath) ?: return null
                if (sourceKind != "ppphp" || operation != "compile") continue
                val outputFile = outputRoot.findFileByRelativePath(output)
                    ?.takeIf { file -> file.isValid && !file.isDirectory }
                    ?: continue
                includeWithAncestors(outputRoot, outputFile, included)
            }

            return PpphpGeneratedPhpLibrary(
                outputRoot,
                included,
                collectExcludedRoots(outputRoot, included),
            )
        }

        private fun collectExcludedRoots(
            outputRoot: VirtualFile,
            included: Set<String>,
        ): Set<VirtualFile> {
            val excluded = linkedSetOf<VirtualFile>()
            val directories = ArrayDeque<VirtualFile>()
            directories += outputRoot
            while (directories.isNotEmpty()) {
                for (child in directories.removeFirst().children) {
                    if (child.url !in included) {
                        excluded += child
                    } else if (child.isDirectory) {
                        directories += child
                    }
                }
            }
            return excluded
        }

        private fun includeWithAncestors(
            outputRoot: VirtualFile,
            outputFile: VirtualFile,
            included: MutableSet<String>,
        ) {
            var current: VirtualFile? = outputFile
            while (current != null) {
                included += current.url
                if (current == outputRoot) return
                current = current.parent
            }
        }

        private fun isSafeRelativePhpPath(path: String): Boolean {
            if (path.isEmpty() || '\\' in path || ':' in path || !path.endsWith(".php", true)) {
                return false
            }
            val components = path.split('/')
            return components.none { component -> component.isEmpty() || component == "." || component == ".." }
        }

        private fun JsonObject.string(name: String): String? = get(name)
            ?.takeIf { value -> value.isJsonPrimitive && value.asJsonPrimitive.isString }
            ?.asString

        private fun JsonObject.integer(name: String): Int? = get(name)
            ?.takeIf { value -> value.isJsonPrimitive && value.asJsonPrimitive.isNumber }
            ?.let { value -> runCatching { value.asInt }.getOrNull() }
    }
}
