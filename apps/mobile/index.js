import { registerRootComponent } from 'expo';

import App from './App';
import { registerHeadlessTasks } from './src/services/tasks/registerHeadlessTasks';

// Must run at entry, not inside a component module: an OS wake-up never
// renders a screen, so anything registered below App's dynamic import of
// PostBootShell is invisible to a headless run. Safe here because the
// module defers every storage-dependent import into the task bodies.
registerHeadlessTasks();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
