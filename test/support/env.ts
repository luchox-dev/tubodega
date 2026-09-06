// Loads .env.test into every vitest worker before any test module is imported.
import { config } from 'dotenv';

config({ path: '.env.test', override: true });
