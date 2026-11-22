import { openNative } from '../src/native.ts';
import { runAppSuite } from './app-suite.ts';

runAppSuite('native', async () => openNative(':memory:'));
