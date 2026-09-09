import {defineConfig} from 'vite';
import {viteSingleFile} from 'vite-plugin-singlefile';
export default defineConfig({root:'supabase/functions/gtm-autoresearch/app',plugins:[viteSingleFile()],build:{outDir:'../dist',emptyOutDir:true}});
