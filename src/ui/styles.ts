// One stylesheet for the panel and the page. Colours come from the host's
// `--oc-*` tokens, with currentColor fallbacks before the ready event.
//
// Layout: a filter bar and the project tree on the left, the run detail as
// cards on the right. A wide frame (data-wide) shows both, the tree in a fixed
// 300 px column that never shrinks; a narrow one shows one at a time.

const line = 'var(--oc-border,color-mix(in srgb,currentColor 18%,transparent))';
const muted = 'var(--oc-muted,color-mix(in srgb,currentColor 60%,transparent))';
const hover = 'var(--oc-hover,color-mix(in srgb,currentColor 7%,transparent))';
const surface = 'var(--oc-muted-surface,color-mix(in srgb,currentColor 5%,transparent))';
const card = 'var(--oc-elevated,var(--oc-bg,transparent))';
const selection = `var(--oc-selection,${hover})`;
const mono = 'var(--oc-mono,ui-monospace,monospace)';
const radius = 'var(--oc-radius,9px)';
const ellipsis = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

export const CSS = `
html,body{margin:0;height:100%}
body{font-family:var(--oc-font,system-ui,sans-serif);font-size:13px;color:var(--oc-fg,inherit);background:var(--oc-bg,transparent)}
*{box-sizing:border-box}
[hidden]{display:none!important}
#root{height:100%}

.cih{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0}
.cih-split{display:flex;flex:1 1 auto;min-height:0;min-width:0}
.cih-col{display:flex;flex-direction:column;min-height:0;min-width:0;flex:1 1 auto}
.cih[data-wide="true"] .cih-col-list{flex:0 0 300px;width:300px;min-width:300px;max-width:300px;border-right:1px solid ${line}}
.cih[data-wide="true"] .cih-col-side{flex:1 1 0}
/* The detail column is the height container its cards size against (cqh). */
.cih-col-side{container:cih-side/size}

.cih-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 10px}
.cih-bar-grow{flex:1 1 auto;min-width:0}
.cih-scroll{flex:1 1 auto;min-height:0;overflow:auto}
.cih-pad{padding:0 10px 12px}
.cih-title{font-weight:600;font-size:14px;margin:0;min-width:0;overflow-wrap:anywhere}
.cih-muted{color:${muted}}
.cih-small{font-size:12px}
.cih-mono{font-family:${mono}}
.cih-chips{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.cih-slot{display:contents}
.cih-link{background:none;border:0;padding:0;font:inherit;color:var(--oc-primary-text,inherit);cursor:pointer;text-decoration:underline}
.cih-branch{font-family:${mono};font-size:11.5px;${ellipsis};max-width:14em}

/* Filter bar */
.cih-fbar{flex:none;display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid ${line};background:var(--oc-bg,transparent)}
.cih-fbar-tabs{min-width:0;overflow-x:auto;scrollbar-width:none}
.cih-fbar-tabs::-webkit-scrollbar{display:none}
.cih-fbar-tabs .oc-sdk-tab{padding:0 8px}
.cih-fbar-pills{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-width:0}
.cih-pill{flex:0 1 auto;min-width:0;max-width:100%}
.cih-pill-grow{flex:1 1 120px;min-width:120px}
.cih-pill-menu{flex:none;margin-left:auto}
.cih-fbar-meta{font-size:11.5px;color:${muted};${ellipsis}}
.cih[data-size="s"] .cih-pill-grow{flex-basis:100%}

/* Notes above the tree and in the detail */
.cih-notes:empty{display:none}
.cih-notes{flex:none}
.cih-note{margin:6px 10px;padding:7px 9px;border:1px solid ${line};border-radius:${radius};font-size:12px}
.cih-note[data-tone="error"]{border-color:var(--oc-error,currentColor);color:var(--oc-error-text,inherit)}
.cih-note[data-tone="warning"]{border-color:var(--oc-warning,currentColor);color:var(--oc-warning-text,inherit)}
.cih-note-actions{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
.cih-quiet{padding:8px 12px;font-size:12px;color:${muted}}
.cih-empty{padding:28px 14px;text-align:center;color:${muted}}
.cih-empty strong{display:block;margin-bottom:4px;color:var(--oc-fg,inherit)}

/* Status dots */
.cih-dot{flex:none;width:10px;height:10px;border-radius:50%;background:${muted}}
.cih-dot[data-tone="success"]{background:var(--oc-success,green)}
.cih-dot[data-tone="error"]{background:var(--oc-error,red)}
.cih-dot[data-tone="warning"]{background:var(--oc-warning,orange)}
.cih-dot[data-tone="info"]{background:transparent;border:2px solid var(--oc-info,var(--oc-primary,currentColor));border-right-color:transparent;animation:cih-spin 1s linear infinite}
.cih-dot[data-tone="muted"]{background:transparent;border:2px solid ${muted}}
@keyframes cih-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.cih-dot[data-tone="info"]{animation:none}}

/* Tree: fixed-height rows placed on a canvas; only the visible window is in the DOM */
.cih-tree{flex:1 1 auto;min-height:0;overflow:auto;position:relative;overscroll-behavior:contain}
.cih-tree-canvas{position:relative;width:100%}
.cih-tree-sticky{position:sticky;top:0;height:0;z-index:2}
.cih-tree-sticky .cih-tr{height:36px;box-shadow:0 1px 0 ${line}}
.cih-tr{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;gap:8px;padding:0 10px;min-width:0;color:inherit;font:inherit;text-align:left;border:0;background:transparent;width:100%}
button.cih-tr,.cih-tr-run{cursor:pointer}
button.cih-tr:hover,button.cih-tr:focus-visible,.cih-tr-run:hover,.cih-tr-run:focus-visible{background:${hover};outline:none}
.cih-tr-project{background:${surface};border-top:1px solid ${line};font-weight:600}
.cih-tr-project:hover,.cih-tr-project:focus-visible{background:color-mix(in srgb,currentColor 9%,transparent)}
.cih-tr-sticky,.cih-tree-sticky .cih-tr-project{background:var(--oc-bg,${surface})}
.cih-tr-name{${ellipsis};min-width:0;flex:0 1 auto}
.cih-tr-owner{${ellipsis};min-width:0;flex:1 1 0;font-weight:400;font-size:12px;color:${muted}}
.cih-tr-sum{flex:none;font-size:11.5px;font-weight:500;color:${muted}}
.cih-tr-sum[data-tone="error"]{color:var(--oc-error-text,var(--oc-error,inherit))}
.cih-tr-sum[data-tone="info"]{color:var(--oc-info-text,var(--oc-info,inherit))}
.cih-tr-sum[data-tone="success"]{color:var(--oc-success-text,var(--oc-success,inherit))}
.cih-chev{flex:none;width:12px;height:12px;display:inline-flex;align-items:center;justify-content:center;color:${muted};transition:transform .12s}
.cih-chev::before{content:"";width:5px;height:5px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg)}
.cih-chev[data-open="true"]{transform:rotate(90deg)}
@media (prefers-reduced-motion:reduce){.cih-chev{transition:none}}
.cih-tr-workflow{padding-left:20px}
.cih-tr-workflow .cih-tr-name{flex:1 1 0}
.cih-tr-run{padding-left:42px;border-left:2px solid transparent}
.cih-tr-run[aria-current="true"]{background:${selection};border-left-color:var(--oc-primary,currentColor)}
.cih-tr-body{display:flex;flex-direction:column;min-width:0;flex:1 1 0;line-height:1.3}
.cih-tr-title{${ellipsis}}
.cih-tr-num{color:${muted}}
.cih-tr-sub{${ellipsis};font-size:11.5px;color:${muted}}
.cih-tr-meta{flex:none;font-size:11.5px;color:${muted}}
.cih-tr-menu{flex:none;display:inline-flex}
.cih-tr-more,.cih-tr-note{padding-left:42px;font-size:12px;color:${muted}}
.cih-tr-more{color:var(--oc-primary-text,inherit)}
.cih-tr-more[data-loading="true"]{color:${muted};cursor:default}
.cih-tr-more[data-tone="error"]{color:var(--oc-error-text,inherit)}
.cih-tr-note{padding-left:34px;font-style:italic}
.cih[data-size="s"] .cih-tr-owner{display:none}

/* Detail: cards */
.cih-detail{display:flex;flex-direction:column;gap:10px;padding:10px}
.cih-detail>.cih-bar{padding:0}
.cih-card{border:1px solid ${line};border-radius:${radius};background:${card};min-width:0;display:flex;flex-direction:column}
.cih-card-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid ${line};min-width:0}
.cih-card-title{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:${muted};flex:none}
.cih-card-sub{font-size:12px;color:${muted};${ellipsis};min-width:0}
.cih-card-sub[data-tone="error"]{color:var(--oc-error-text,var(--oc-error,inherit));font-weight:500}
.cih-head{padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.cih-head-top{display:flex;gap:8px;align-items:center;min-width:0}
.cih-kv{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:12px;color:${muted}}
.cih-kv a{color:inherit}
.cih-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding-top:4px}
.cih-section{padding:8px 10px 4px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:${muted}}
.cih-card-jobs{flex:0 1 auto;max-height:max(30cqh,480px);min-height:min(25cqh,160px)}
.cih-jobs{display:flex;flex-direction:column;padding:4px 0;flex:1 1 auto;min-height:0;overflow:auto}
.cih-job{display:grid;grid-template-columns:10px 1fr auto;gap:8px;align-items:center;padding:6px 10px;cursor:pointer;border:0;background:transparent;color:inherit;font:inherit;text-align:left;width:100%}
.cih-job:hover,.cih-job:focus-visible{background:${hover};outline:none}
.cih-job[aria-current="true"]{background:${selection}}
.cih-job-name{overflow-wrap:anywhere}
.cih-steps{display:flex;flex-direction:column;padding:2px 10px 8px 28px;gap:1px}
.cih-step{display:grid;grid-template-columns:8px 1fr auto;gap:6px;align-items:center;font-size:12px;padding:2px 6px;border-radius:calc(${radius} - 4px)}
.cih-step .cih-dot{width:8px;height:8px}
.cih-step[data-failed="true"]{background:color-mix(in srgb,var(--oc-error,red) 14%,transparent);font-weight:600}

/* Log */
.cih-log{flex:1 0 0;min-height:max(30cqh,320px)}
.cih-log-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 10px}
.cih-log-modes{border-bottom:1px solid ${line}}
.cih-log-body{font-family:${mono};font-size:11.5px;line-height:1.45;padding:6px 0 10px;flex:1 1 0;min-height:0;overflow:auto;background:${surface};border-top:1px solid ${line};border-radius:0 0 ${radius} ${radius}}
.cih-ln{display:grid;grid-template-columns:auto 1fr;gap:10px;padding:0 10px;white-space:pre-wrap;word-break:break-word}
.cih-ln-no{color:${muted};text-align:right;user-select:none;min-width:3ch}
.cih-ln[data-tone="error"]{background:color-mix(in srgb,var(--oc-error,red) 14%,transparent);color:var(--oc-error-text,inherit)}
.cih-ln[data-tone="warning"]{color:var(--oc-warning-text,inherit)}
.cih-ln[data-tone="command"]{color:var(--oc-info-text,inherit)}
.cih-ln[data-tone="group"]{font-weight:600;cursor:pointer}
.cih-ln[data-depth="1"] .cih-ln-text{padding-left:14px}
.cih-ln mark{background:color-mix(in srgb,var(--oc-warning,orange) 40%,transparent);color:inherit;border-radius:2px}
.cih-ln[data-hit="current"]{outline:1px solid var(--oc-warning,orange);outline-offset:-1px}
.cih[data-size="s"] .cih-ln{gap:6px;padding:0 6px}
.cih[data-size="s"] .cih-ln-no{display:none}

/* Forms and settings */
.cih-form{display:flex;flex-direction:column;gap:10px;padding:10px}
.cih-form-row{display:flex;gap:6px;align-items:end;flex-wrap:wrap}
.cih-form-row>*{flex:1 1 160px;min-width:0}
.cih-repo{display:grid;grid-template-columns:1fr auto;gap:6px;align-items:center;padding:6px 10px;border-bottom:1px solid ${line}}
.cih[data-size="s"] .cih-detail{padding:8px;gap:8px}
`;
