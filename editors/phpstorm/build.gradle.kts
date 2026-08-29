import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    java
    kotlin("jvm") version "2.4.10"
    id("org.jetbrains.intellij.platform") version "2.18.1"
}

group = "com.atatusoft.ppphp"
version = providers.gradleProperty("pluginVersion").get()

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
        phpstorm("2026.2.0.1")
        bundledPlugin("org.jetbrains.plugins.textmate")
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_25
    targetCompatibility = JavaVersion.VERSION_25
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_25
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "com.atatusoft.ppphp"
        name = "++PHP"
        version = project.version.toString()

        ideaVersion {
            sinceBuild = "262"
        }
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
    outputs.file(repositoryRoot.file("packages/language-server/dist/server.cjs"))
}

tasks.withType<PrepareSandboxTask>().configureEach {
    dependsOn(buildLanguageServer)

    from(repositoryRoot.file("packages/language-server/dist/server.cjs")) {
        into(pluginName.map { "$it/server" })
    }
    from(repositoryRoot.dir("res/textmate/ppphp")) {
        into(pluginName.map { "$it/textmate/ppphp" })
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
