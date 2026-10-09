// Configuração pública do Supabase. Esta chave (anon) é feita para ficar visível no site:
// o que ela pode ou não fazer é controlado pelas regras de segurança do banco.
// NUNCA coloque aqui a chave "service_role" / "secret".
window.ELEV_CONFIG = {
  SUPABASE_URL: 'https://oiewmoahigcwyjwawlak.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pZXdtb2FoaWdjd3lqd2F3bGFrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1MjU5ODAsImV4cCI6MjEwNzEwMTk4MH0.mixyiUOQlIZUCPNNGcHjIGk-_FHFlshhUgCF1FXN7Aw',
  STORAGE_GB: 1 // espaço do plano do Supabase, só para o medidor do painel
};
