// Shown the moment a sidebar link is clicked, until the page arrives. Every
// page here renders on the server, so without it the old page stays up and
// the click looks ignored.
const ROW_WIDTHS = ["46%", "32%", "58%", "40%", "51%", "28%", "44%"];

export default function WorkspaceLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className="grid animate-in content-start gap-5.5 duration-150 fill-mode-backwards [animation-delay:120ms] fade-in"
      role="status"
    >
      <span className="h-7 w-40 rounded-md bg-hover" />
      <span className="h-8 w-72 max-w-full rounded-md bg-hover" />
      <div className="grid gap-px">
        {ROW_WIDTHS.map((width) => (
          <div className="flex h-11 items-center gap-3 px-1.5" key={width}>
            <span className="size-5 shrink-0 rounded-sm bg-hover" />
            <span className="h-3 rounded-sm bg-hover" style={{ width }} />
          </div>
        ))}
      </div>
    </div>
  );
}
