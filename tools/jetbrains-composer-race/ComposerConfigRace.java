package com.jetbrains.php.composer.configData;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.vfs.VirtualFile;
import com.intellij.testFramework.LightVirtualFile;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/** Bounded upstream probe: only unmodified JetBrains classes, never shipped in the plugin. */
public final class ComposerConfigRace {
  public static void main(String[] args) throws Exception {
    try {
      Class.forName("com.atatusoft.ppphp.PpphpLanguage");
      throw new AssertionError("++PHP must not be on the probe classpath");
    } catch (ClassNotFoundException expected) { }
    Project project = (Project) Proxy.newProxyInstance(Project.class.getClassLoader(), new Class<?>[]{Project.class},
      (proxy, method, values) -> { throw new AssertionError("Unexpected project access: " + method); });
    VirtualFile file = new LightVirtualFile("composer.json", "{}");
    ComposerConfigClient<Integer> client = new ComposerConfigClient<>() {
      public boolean isAccept(Project p, VirtualFile f) { return true; }
      public List<String> getPath() { return List.of("autoload.psr-4"); }
      public Integer parse(Project p, Map<String, JsonElement> data, VirtualFile f) { return 1; }
      public void consume(Integer data, Project p) { }
    };
    ComposerConfigListener<Integer> listener = new ComposerConfigListener<>(client);
    JsonObject json = new JsonObject();
    for (int i = 0; i < 10000; i++) { listener.inform(json, file, project, true); listener.reset(null); }
    System.out.println("Sequential inform/reset: 10000 operations passed; ++PHP absent.");
    AtomicBoolean stop = new AtomicBoolean();
    Thread resetter = new Thread(() -> { while (!stop.get()) listener.reset(null); }, "composer-reset-probe");
    resetter.setDaemon(true);
    resetter.start();
    boolean reproduced = false;
    long deadline = System.nanoTime() + 5_000_000_000L;
    int count = 0;
    try {
      while (System.nanoTime() < deadline) {
        listener.inform(json, file, project, true);
        count++;
      }
    } catch (NullPointerException error) {
      if (!error.getStackTrace()[0].getClassName().equals("com.jetbrains.php.composer.configData.ComposerConfigListener")
          || !error.getStackTrace()[0].getMethodName().equals("getNewData")) throw error;
      reproduced = true;
      System.out.println("Concurrent native inform/reset reproduced after " + count + " calls: " + error);
      System.out.println("  at " + error.getStackTrace()[0]);
    } finally {
      stop.set(true);
      resetter.join(1000);
    }
    if (!reproduced) throw new AssertionError("Race not observed within the bounded probe; this is not proof of absence");
  }
}
