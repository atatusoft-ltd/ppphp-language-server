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
        phpstorm("2025.2.1")
        // Present on PhpStorm's boot classpath, but omitted from the Gradle SDK view.
        bundledLibrary("lib/app-client.jar")
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

intellijPlatform {
    pluginConfiguration {
        id = "com.atatusoft.ppphp"
        name = "++PHP"
        version = project.version.toString()

        ideaVersion {
            sinceBuild = "252"
        }
    }

    pluginVerification {
        ides {
            create("PS", "2025.2.1")
            create("PS", "2026.2.0.1")
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
