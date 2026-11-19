const {withAppDelegate,withInfoPlist}=require('@expo/config-plugins');
const marker='// Emotional Island scene lifecycle';
function migrate(source){
 if(source.includes(marker))return source;
 const old=`#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif`;
 if(!source.includes(old))throw new Error('Scene migration: unexpected AppDelegate startup; review native template.');
 source=source.replace('  var window: UIWindow?','  var window: UIWindow?\n  var initialLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?');
 source=source.replace(old,'    initialLaunchOptions = launchOptions');
 const insertion=`  ${marker}
  public func application(_ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions) -> UISceneConfiguration {
    let configuration = UISceneConfiguration(name: "Main", sessionRole: connectingSceneSession.role)
    configuration.delegateClass = IslandSceneDelegate.self
    return configuration
  }

  func connectWindow(to scene: UIWindowScene) -> UIWindow {
    let window = UIWindow(windowScene: scene)
    self.window = window
    reactNativeFactory?.startReactNative(withModuleName: "main", in: window, launchOptions: initialLaunchOptions)
    return window
  }

`;
 source=source.replace('  // Linking API',insertion+'  // Linking API');
 return source+`
class IslandSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  private var appDelegate: AppDelegate? { UIApplication.shared.delegate as? AppDelegate }

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene, let delegate = appDelegate else { return }
    window = delegate.connectWindow(to: windowScene)
    self.scene(scene, openURLContexts: options.urlContexts)
    for activity in options.userActivities { self.scene(scene, continue: activity) }
  }
  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {    for context in contexts {
      _ = appDelegate?.application(UIApplication.shared, open: context.url, options: [
        .sourceApplication: context.options.sourceApplication as Any,
        .openInPlace: context.options.openInPlace
      ])
    }
  }
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate?.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
  func sceneDidBecomeActive(_ scene: UIScene) { appDelegate?.applicationDidBecomeActive(UIApplication.shared) }
  func sceneWillResignActive(_ scene: UIScene) { appDelegate?.applicationWillResignActive(UIApplication.shared) }
  func sceneWillEnterForeground(_ scene: UIScene) { appDelegate?.applicationWillEnterForeground(UIApplication.shared) }
  func sceneDidEnterBackground(_ scene: UIScene) { appDelegate?.applicationDidEnterBackground(UIApplication.shared) }
}
`;
}
function plugin(config){
 config=withInfoPlist(config,mod=>{
  mod.modResults.UIApplicationSceneManifest={UIApplicationSupportsMultipleScenes:false,
   UISceneConfigurations:{UIWindowSceneSessionRoleApplication:[{UISceneConfigurationName:'Main',UISceneDelegateClassName:'$(PRODUCT_MODULE_NAME).IslandSceneDelegate'}]}};
  return mod;
 });
 return withAppDelegate(config,mod=>{if(mod.modResults.language!=='swift')throw new Error('Swift AppDelegate required');mod.modResults.contents=migrate(mod.modResults.contents);return mod;});
}
module.exports=plugin;module.exports.migrate=migrate;
