// Configuração pública do Supabase. Esta chave (anon) é feita para ficar visível no site:
// o que ela pode ou não fazer é controlado pelas regras de segurança do banco.
// NUNCA coloque aqui a chave "service_role" / "secret".
window.ELEV_CONFIG = {
  SUPABASE_URL: 'https://oiewmoahigcwyjwawlak.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pZXdtb2FoaWdjd3lqd2F3bGFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MjU5ODAsImV4cCI6MjEwNzEwMTk4MH0.mixyiUOQlIZUCPNNGcHjIGk-_FHFlshhUgCF1FXN7Aw',
  // Endereço do Worker da Cloudflare que guarda imagens e vídeos (R2). Vazio = usa o Supabase Storage.
  MEDIA_BASE: '',
  STORAGE_GB: 0 // 0 = automático (10 GB com R2, 1 GB sem)
};
