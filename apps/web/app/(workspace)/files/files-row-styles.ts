// Shared by file rows, upload rows and the column header so the grids line up.
// Compact grid below 1024px, wider from 1024px, three columns on touch.
export const ROW_GRID =
  "grid items-center grid-cols-[28px_minmax(0,1fr)_76px_132px] gap-x-2.5 lg:grid-cols-[36px_minmax(0,1fr)_104px_170px] lg:gap-x-3.5 max-md:grid-cols-[34px_minmax(0,1fr)_42px] pointer-coarse:grid-cols-[34px_minmax(0,1fr)_42px]";

export const ROW_BASE =
  "relative h-10 cursor-default rounded-md pr-2 pl-1 transition-colors duration-150 outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/60 motion-reduce:transition-none lg:h-row lg:pr-3 lg:pl-2 max-md:h-auto max-md:min-h-14 max-md:touch-manipulation max-md:px-1 max-md:py-1.75 pointer-coarse:h-auto pointer-coarse:min-h-14 pointer-coarse:touch-manipulation pointer-coarse:px-1 pointer-coarse:py-1.75";

export const ROW_ICON_CELL =
  "flex shrink-0 items-center justify-center [&_svg]:size-4 lg:[&_svg]:size-5";

export const ROW_ICON =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-sm lg:size-7.5";

export const ROW_NAME_CELL =
  "flex min-w-0 items-center gap-1.5 overflow-hidden max-md:col-start-2 pointer-coarse:col-start-2";

export const ROW_NAME =
  "min-w-0 flex-1 truncate text-sm leading-snug font-medium text-foreground/90 hover:text-foreground lg:text-body max-md:text-meta pointer-coarse:text-meta";

export const ROW_META =
  "truncate text-right text-xs whitespace-nowrap text-muted-foreground lg:text-meta max-md:hidden pointer-coarse:hidden";
