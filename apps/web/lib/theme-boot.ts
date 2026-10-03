/**
 * Runs in <head> before paint. Resolves the "system" preference that the
 * server cannot know.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;if(d.classList.contains("dark")||d.classList.contains("light"))return;d.classList.add(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light")}catch(e){}})();`;
