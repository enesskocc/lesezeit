// Zod schemas shared by the app (src/) and the pipeline (pipeline/, milestone 3+).
// Every JSON file read from lesezeit-data is validated against one of these.
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD bekleniyor');

/** lesezeit-data/test/hello.json — milestone 1 connectivity check. */
export const TestFileSchema = z.object({
  message: z.string().min(1),
  createdAt: isoDate,
});
export type TestFile = z.infer<typeof TestFileSchema>;
