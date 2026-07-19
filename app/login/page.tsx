import { LoginButton } from "@/components/login-button";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import Link from "next/link";
export default function LoginPage() {
  return <main className="content" style={{display:"grid",minHeight:"100dvh",placeItems:"center"}}><section className="card" style={{maxWidth:460,textAlign:"center"}}><div className="eyebrow">AI Life OS</div><h1 style={{fontSize:"2.4rem",letterSpacing:"-.05em"}}>ChronoPilot</h1><p className="muted">人生をデバッグするAI。<br/>今やることを、ひとつだけ。</p>{hasSupabaseConfig ? <LoginButton /> : <><Link className="button" href="/">デモモードで試す</Link><p className="muted" style={{fontSize:12}}>Supabase環境変数を設定するとGoogleログインになります。</p></>}</section></main>;
}
