import { openNative } from '../src/native.ts';
import { runEngineSuite } from './suite.ts';

runEngineSuite('native', async () => openNative(':memory:'));
