import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask
import org.jetbrains.intellij.platform.gradle.tasks.VerifyPluginTask
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import groovy.json.JsonSlurper

plugins {
    java
    kotlin("jvm") version "2.4.10"
    id("org.jetbrains.intellij.platform") version "2.18.1"
}

group = "com.atatusoft.ppphp"
version = providers.gradleProperty("pluginVersion").get()

val compatibility = JsonSlurper().parse(file("compatibility.json")) as Map<*, *>
val platformSdk = providers.gradleProperty("platformVersion").getOrElse(compatibility["sdk"] as String)
val verificationType = providers.gradleProperty("verificationType")
val verificationVersion = providers.gradleProperty("verificationVersion")

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")

    intellijPlatform {
        testFramework(TestFrameworkType.Platform)
        phpstorm(platformSdk)
        // Present on PhpStorm's boot classpath, but omitted from the Gradle SDK view.
        if (platformSdk == "2025.2.1") bundledLibrary("lib/app-client.jar")
        bundledPlugin("JavaScript")
        bundledPlugin("com.jetbrains.php")
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_21
    }
}

sourceSets {
    test {
        resources.srcDir(layout.projectDirectory.dir("../fixtures"))
    }
}

// Opt-in real-runtime experiment; excluded from normal tests and shipped artifacts.
if (providers.gradleProperty("debuggerSpike").orNull == "true") {
    val spikeTemp = providers.environmentVariable("PPPHP_SPIKE_TEMP").get()
    intellijPlatform.sandboxContainer.set(file("$spikeTemp/phpstorm-sandbox"))
    intellijPlatform.pluginVerification.verificationReportsDirectory.set(file("$spikeTemp/phpstorm-verification"))
    kotlin.sourceSets.named("test") {
        kotlin.srcDir("../../tools/debugger-spike/phpstorm")
    }
    tasks.withType<Test>().configureEach {
        // IDE logs and test captures must remain outside user workspaces.
        systemProperty("idea.log.path", "$spikeTemp/phpstorm-log")
        reports.junitXml.outputLocation = file("$spikeTemp/phpstorm-test-results")
        reports.html.outputLocation = file("$spikeTemp/phpstorm-test-report")
        binaryResultsDirectory.set(file("$spikeTemp/phpstorm-test-binary"))
        testLogging.showStandardStreams = true
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "com.atatusoft.ppphp"
        name = "++PHP"
        version = project.version.toString()
        changeNotes = """
            <ul>
                <li>Failed analysis replaces obsolete source errors with a current-document
                    analysis-unavailable warning. Successful analysis clears that warning.</li>
                <li>Compiler memory exhaustion and process failures report their actual causes
                    without misleading protocol-upgrade advice or raw fatal-error stacks.</li>
                <li>Compiler selection, project pins and configured memory limits remain unchanged.</li>
            </ul>
        """.trimIndent()

        ideaVersion {
            sinceBuild = compatibility["sinceBuild"] as String
            untilBuild = compatibility["untilBuild"] as String
        }
    }

    pluginVerification {
        failureLevel = listOf(
            VerifyPluginTask.FailureLevel.COMPATIBILITY_PROBLEMS,
            VerifyPluginTask.FailureLevel.INVALID_PLUGIN,
            VerifyPluginTask.FailureLevel.MISSING_DEPENDENCIES,
            VerifyPluginTask.FailureLevel.SCHEDULED_FOR_REMOVAL_API_USAGES,
            VerifyPluginTask.FailureLevel.NON_EXTENDABLE_API_USAGES,
        )
        ides {
            if (verificationType.isPresent || verificationVersion.isPresent) {
                require(verificationType.isPresent && verificationVersion.isPresent) {
                    "Both verificationType and verificationVersion are required"
                }
                create(verificationType.get(), verificationVersion.get())
            } else {
                for (ide in compatibility["ides"] as List<*>) {
                    val target = ide as Map<*, *>
                    create(target["type"] as String, target["version"] as String)
                }
            }
        }
    }
}

// CI verifies the exact ZIP produced by the build job, not a second local rebuild.
tasks.named<VerifyPluginTask>("verifyPlugin") {
    providers.gradleProperty("verificationArchive").orNull?.let {
        archiveFile.set(file(it))
    }
}

providers.environmentVariable("PPPHP_BUILD_REPORTS").orNull?.let { output ->
    intellijPlatform.sandboxContainer.set(file("$output/sandbox"))
    intellijPlatform.pluginVerification.verificationReportsDirectory.set(file("$output/verification"))
    tasks.withType<Test>().configureEach {
        systemProperty("idea.log.path", "$output/idea-log")
        reports.junitXml.outputLocation.set(file("$output/test-results"))
        reports.html.outputLocation.set(file("$output/test-report"))
        binaryResultsDirectory.set(file("$output/test-binary"))
    }
}

val repositoryRoot = layout.projectDirectory.dir("../..")
val buildLanguageServer by tasks.registering(Exec::class) {
    group = "build"
    description = "Builds the editor-neutral ++PHP language server."
    workingDir(repositoryRoot)
    commandLine(
        if (System.getProperty("os.name").startsWith("Windows", ignoreCase = true)) "npm.cmd" else "npm",
        "run",
        "build:server",
    )
    inputs.files(fileTree(repositoryRoot.dir("packages/language-server/src")))
    inputs.file(repositoryRoot.file("packages/language-server/package.json"))
    inputs.file(repositoryRoot.file("res/textmate/ppphp/syntaxes/ppphp.tmLanguage.json"))
    outputs.file(repositoryRoot.file("packages/language-server/dist/server.cjs"))
}

tasks.withType<PrepareSandboxTask>().configureEach {
    dependsOn(buildLanguageServer)

    from(repositoryRoot.file("packages/language-server/dist/server.cjs")) {
        into(pluginName.map { "$it/server" })
    }
}

tasks.processResources {
    from(repositoryRoot.file("res/images/ppphp-emblem.svg")) {
        into("META-INF")
        rename { "pluginIcon.svg" }
        filter { line: String ->
            line.replace("width=\"1024\"", "width=\"40\"")
                .replace("height=\"1024\"", "height=\"40\"")
        }
    }
    from(repositoryRoot.file("res/images/ppphp-emblem.svg")) {
        into("icons")
        rename { "ppphp.svg" }
        filter { line: String ->
            line.replace("width=\"1024\"", "width=\"16\"")
                .replace("height=\"1024\"", "height=\"16\"")
        }
    }
}

tasks {
    buildSearchableOptions {
        enabled = false
    }
}
