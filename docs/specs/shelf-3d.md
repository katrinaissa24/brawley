# LENS: CSS 3D / rendering-performance (DOM-only book shelf and page-flip, no WebGL)

## SUMMARY
Every book is a closed 5-face CSS box (spine, front cover, back cover, top edge, contact shadow) built from ~7 DOM nodes and driven by CSS variables (--x, --spine-w, --pull, --breathe, --cover, --ink) so React never touches a book during scroll or hover. The shelf is a native horizontal scroller whose only scrollable content is an invisible spacer; a position:sticky stage (perspective 1400px, origin 50% 30%) holds the preserve-3d row, a flat hit-strip and a flat label layer, all three translated per frame from scrollLeft in one rAF (or by a scroll-driven animation where supported). Books are windowed (only ~30 mounted from prefix-sum positions, binary search per frame), have contain: layout style (never paint/strict, which would clip the 3D faces), and cast one radial-gradient face lying on the plank instead of per-face box-shadows. Hover pulls the book 44px toward the eye and swings the cover 22deg with a spring-like curve while the two neighbours lean away 4deg by writing --breathe on four elements; a 60ms grace and a widened hit slot kill flicker. The open book is a second, separate 3D scene: each sheet is a hinge at the gutter with front/back faces (backface-visibility hidden), rotated by --a (0 to -180deg) that JS writes in rAF for both drag (grab-point-exact mapping a = acos((x - spineX)/r)) and spring settle; all shading, gloss and the cast shadow on the page beneath are pure CSS functions of --a via sin()/cos() on opacity/scaleX, so no gradient re-rasterizes. z-index is meaningless in preserve-3d, so stacking is done with visibility plus 1px/2px translateZ lifts on in-flight sheets. Closed-block thickness on either side is a registered numeric --thick that transitions and drives scaleX of edge faces. The document renders inside each face as the same read-only DocumentView tree scaled with transform: scale(--page-scale) from a fixed 840x1200 logical page, contain: strict, never re-laid-out. Opening a page runs a WAAPI FLIP (two rect reads per gesture, compositor-driven transform) from the face to the full editor page. Budget: shelf scroll = 2 to 3 transform writes and zero layout per frame at <=150 layers; flip = one var write on <=3 elements; will-change is permanent only on the two always-moving layers and transient everywhere else; no backdrop-filter/blur/opacity/overflow on any preserve-3d ancestor (Safari flattens it); coplanar faces are separated by >=1px translateZ.

## DECISIONS
- **topic**: Book box geometry and transform tree | **decision**: A book is a box with x = spine width (16..56px from page count: round(clamp(16, 10 + pages*2.2, 56))), y = 224px (constant for all books), z = 152px (cover width, i.e. depth into the shelf). The .book root is a flat spine-w x 224 element, position:absolute, transform-style: preserve-3d, placed with translate3d(var(--x)) and standing so its bottom sits on the plank. Faces (all position:absolute, backface-visibility hidden): spine = translateZ(76px) facing the viewer; front cover = element 152x224 positioned with left: calc(var(--spine-w)/2 - 76px) then rotateY(90deg) translateZ(calc(var(--spine-w)/2)) so its plane is at x = spine-w facing +x with its spine edge at the front; back cover = same with rotateY(-90deg); top edge = element spine-w x 152 positioned with top: calc(112px - 76px) then rotateX(90deg) translateZ(112px) so it lies on the top of the box with its normal pointing up; bottom and fore-edge faces are never rendered (never visible with the camera above the shelf and spines facing the viewer). The shadow is a fifth face rotateX(90deg) lying on the plank plane at the book's foot. | **rationale**: Centering each face on the book's mid-axis and using rotate-then-translateZ keeps every face expressed as one transform with no magic offsets, makes the closed box free of intersecting planes (Chrome BSP-splits intersecting 3D layers, which is expensive), and lets the whole pull-out/rotate be a single transform on the root while the faces stay static and rasterized once.
- **topic**: Which faces get lighting and how | **decision**: Static per-face lighting baked into backgrounds: spine gets a horizontal gradient overlay (dark 0.20 at the left edge, +0.10 white at 14%, fading to dark 0.14 at the right) to read as a slightly curved spine; front cover gets a flat 0.06 darkening (side-lit); top edge gets +0.18 white (lit from above) plus the page-lines pattern inset by 2px cover-colored borders on left/right/back (boards overhang the page block, no overhang on the spine side). A shared paper texture is an SVG feTurbulence tile (96px, alpha ~0.07) used as a plain background layer, not a blend mode. Spine title emboss is text-shadow 0 1px 0 rgba(255,255,255,.22), 0 -1px 0 rgba(0,0,0,.28) with color = --ink (dark or light ink picked from cover luminance). No dynamic lighting on hover except the shadow face's opacity. | **rationale**: Gradients and text-shadow are rasterized once per face and then only composited; mix-blend-mode and dynamic gradients would force isolation groups or per-frame repaints. The 22deg hover swing is small enough that static lighting stays believable.
- **topic**: Shadow strategy | **decision**: No box-shadow on any face. Per book: one .book__shadow face (a radial-gradient ellipse, spine-w+40 by 176px) rotated onto the plank plane under the book, opacity calc(.28 + var(--pull)*.18) and scale calc(1 + var(--pull)*.3). Shelf-wide: one static soft gradient band on the wall behind the row (all books are the same height, so their combined wall shadow is a single band) and one static lip shadow under the plank front edge. | **rationale**: box-shadow on 3D-transformed elements is re-rasterized into the layer and doubles layer texture size; 200 books x 4 faces of blurred shadows is the first thing that kills a 3D shelf. One gradient face per book that moves with the book's own transform is free.
- **topic**: Spine text | **decision**: writing-mode: vertical-rl with default text-orientation: mixed inside the spine face (reads top-to-bottom, letters rotated clockwise, as on English spines), white-space: nowrap, overflow hidden, text-overflow ellipsis, font = the Iowan Old Style serif stack, size clamp(9px, spine-w * 0.52, 15px), 600 weight. Books with spine-w < 14px render no spine text (data-thin) and rely on the hover label; aria-label stays on the root. | **rationale**: vertical-rl is the only way to get real vertical text flow (ellipsis, centering, no rotated-box sizing hacks) and it rasterizes like normal text; rotate(90deg) on a horizontal span makes sizing and clipping guesswork.
- **topic**: Cover customization rendering | **decision**: Cover model {kind: solid|gradient|image, color, color2, angle, thumbId, titleStyle: band|plain|none, ink: auto|dark|light} is reduced to CSS variables on .book (--cover, --cover-2, --cover-angle, --ink) plus data-kind. Solid and gradient both use linear-gradient(var(--cover-angle), var(--cover), var(--cover-2)) (solid sets color2 = color) on spine and covers so the gradient continues around the corner. Image covers render an <img> (object-fit: cover, draggable=false, decoding=async) on the front cover only, from a 320x480 WebP/JPEG thumbnail rasterized at import time and stored in IndexedDB alongside the original; the spine uses the dominant color sampled from a 1x1 canvas draw of the thumbnail (stored, not recomputed). Title overlay styles: band = a cream paper strip over the lower third with serif title; plain = title over a bottom scrim gradient; none. Ink = auto picks dark (#2b2620) or light (#f4efe6) from relative luminance > 0.55. | **rationale**: Everything the customization panel can change becomes a variable or a data attribute, so a cover edit touches one element and no book re-renders its geometry. Thumbnails keep 200 mounted-and-unmounted covers cheap to decode (a full 4000px photo per book would blow the raster budget); the spine cannot show a meaningful slice of the image at 16..56px anyway.
- **topic**: Label pill placement | **decision**: Labels live outside the 3D tree in a flat .shelf__labels overlay (pointer-events none) that receives the same translate3d(-scrollX) as the row every frame. A label is an absolutely positioned pill centered at the hovered book's x + spine-w/2, above the book top; the two connector dots are ::before (9px, 13px below) and ::after (5px, 22px below), all with the paper background, hairline border and a soft drop shadow. Entry choreography: small dot 0ms, big dot 60ms, pill 120ms, each ~220ms with a slightly overshooting cubic-bezier(.2,.9,.3,1.15); exit is a single 120ms fade. | **rationale**: Text inside a preserve-3d subtree is rasterized under perspective and comes out blurry, and the pill would need its own z-fighting-free plane. A flat sibling layer that mirrors the row transform costs one extra style write per frame and stays pixel-crisp.
- **topic**: Scrolling: native scroller + sticky stage + transform mirror (not pure wheel/translate) | **decision**: The shelf is a native horizontal scroll container (.shelf: overflow-x auto, overflow-y hidden, scrollbar hidden, overscroll-behavior-x: contain, container-type: inline-size, optional scroll-snap-type: x proximity when 'detents' is on). Its only in-flow content is .shelf__track (width = total row width, height 100%); inside it .shelf__stage is position: sticky; left: 0; width: 100cqw; height: 100% and carries perspective. The stage holds the fixed wall, the preserve-3d row, the flat hit strip and the flat labels layer. A passive scroll listener stores scrollLeft and schedules one rAF that writes translate3d(-x,0,0) to row/hits/labels, computes the mounted window and fires detent callbacks. Where CSS scroll-driven animations are supported (CSS.supports('animation-timeline: scroll()')), those three layers are instead bound with animation-timeline: scroll(nearest x) to keyframes 0 to -(rowWidth - viewportWidth) and the rAF only does windowing/detents. | **rationale**: Native scroll gives macOS trackpad inertia, rubber-band and accessibility for free; re-implementing momentum from wheel events never feels like the OS. The sticky stage keeps the 3D scene pinned by the compositor while wheel events on books still bubble to the scroller. overscroll-behavior-x: contain is mandatory or two-finger overscroll triggers browser back/forward navigation. The row itself cannot be inside a scrolled/overflow-clipped preserve-3d element (Safari flattens it, and the pull-out must escape the clip), which is why the scene is a sticky sibling of the spacer rather than the scrolled content. The scroll-timeline path removes the last frame of latency and the main-thread dependency; the rAF path is the baseline.
- **topic**: Virtualization and containment | **decision**: Book x positions are prefix sums of spine widths (Float64Array, recomputed only when entries change). Per frame: lowerBound(xs, scrollX - 260) and lowerBound(xs, scrollX + vw + 260) give the window; React state is set only when the integer range changes (memoized Book3D, keyed by entry id). Each .book is position:absolute with a static --x, contain: layout style (not paint, not strict). content-visibility is not used on books. Plank segments (1200px wide faces) are windowed the same way and are children of the row so they scroll for free. Hit slots and labels get contain: strict. Newly windowed image covers are pre-decoded during idle (img.decode()) one window ahead. | **rationale**: 200 books x 6 nodes is 1200 layers if all mounted; ~30 x 6 is trivial. Absolute positioning means mounting/unmounting a book never relayouts siblings. contain: paint / strict / content-visibility clip to the element box and the 3D faces extend well outside it (a 16px-wide book has a 152px-deep cover), so they would either clip the box or (in Safari) flatten the subtree.
- **topic**: Hover: pull-out, breathing, hit testing | **decision**: Books have pointer-events: none. A flat .shelf__hits strip (same translate as the row) holds one transparent slot per mounted book (left = xs[i], width = spine-w); a delegated pointerover/pointerout on the strip resolves the id, sets data-hover on the book element via a ref registry (id -> element), writes --breathe = -1/+1 on the immediate neighbours and -0.4/+0.4 on the next pair, widens the active slot (transform: scaleX(1.6), no layout), and clears with a 60ms grace timer. Only the label content goes through React state. Pull-out transform on .book: translate3d(calc(var(--x) + var(--breathe)*6px), 0, calc(var(--pull)*44px)) rotateY(calc(var(--pull)*-22deg + var(--breathe)*-4deg)); transition 300ms cubic-bezier(.34,1.4,.64,1) on enter, 260ms cubic-bezier(.22,1,.36,1) on leave; will-change: transform only while data-hover, removed on transitionend. prefers-reduced-motion: no rotation, 14px lift, no breathing. | **rationale**: Hit-testing 3D faces directly flickers because the pulled book and its leaning neighbours change the geometry under the cursor; a stable 2D strip with hysteresis is deterministic. Writing two variables on four elements recomputes four transforms and zero layout, satisfying the zero-lag rule. The slight overshoot on enter is what makes the pop feel physical.
- **topic**: Open-book scene structure | **decision**: A separate fixed overlay (.ob, perspective 2400px, origin 50% 42%) with .ob__book (preserve-3d) whose local x = 0 is the gutter/spine line. Pages are PAGE_W = min(42vw, 480px) x PAGE_H = PAGE_W * 1.4286 (5:7), computed on resize into --page-w/--page-h and --page-scale = PAGE_W / 840. Children: back cover (static, under everything, translateZ(-1px)), left closed block, right closed block, sheets (one per physical sheet = two document pages; React mounts only indexes cur-2..cur+2 with content), front cover (a 3px box: outer face at +2px, inner face rotateY(180deg), fore-edge strip). A sheet = 0 0 origin at the gutter, transform-origin: 0 50%, transform: translateZ(var(--lift,0px)) rotateY(var(--a)); faces: -front (recto, right page) and -back (rotateY(180deg), verso, becomes the next left page), both backface-visibility hidden and overflow hidden (faces are 3D leaves, so overflow is safe there). .ob__book is centered with translateX(calc((1 + cos(var(--cover-a))) * var(--page-w) / -4)) so a closed book is centered on its single page width and an open book on the spread. | **rationale**: Hinging sheets at x=0 makes the whole flip one rotateY; putting the document inside the face (not the sheet) keeps the face the only element with overflow; cos(--cover-a) ties the re-centering to the cover's actual angle so opening the cover and sliding the book left are one motion.
- **topic**: Angle -> shading and z-order during flip | **decision**: JS owns the angle: it writes --a (deg) on the flipping sheet and on the two 'under' cast elements only (inherits: false, at most 3 elements per frame), both during drag and during the spring settle. CSS derives everything else from --a with trig: front-face shade opacity = -sin(--a) * .8 (0 at 0deg, peak at -90, 0 at -180), back-face shade with a gloss stripe near the hinge = -sin(--a) * .7, cast shadow on the right under-page: opacity -sin(--a), transform scaleX(max(0, cos(--a))) with origin at the gutter; on the left under-page scaleX(max(0, -cos(--a))) with origin at the right edge. Shades are static-gradient child elements whose opacity/transform change, never gradients with variables in stops. Stacking: at rest only two faces are visible (current left = previous sheet's back, current right = current sheet's front), every other sheet is visibility: hidden; during a flip exactly three sheets are live (the flipping one lifted, the two beneath at 0). With two sheets in flight the earlier-started one is physically on top so it gets --lift 2px and the second 1px; max two in flight, further clicks queue. z-index is never used inside the 3D context. The cover uses the same machinery with a heavier spring (k 110 vs 170) and a --cover-a on the root for centering. | **rationale**: opacity and transform are compositor properties: the sheet's rasters never repaint during a flip. A registered inherited --a on the root would trigger per-frame style recalc across the DocumentView subtrees; writing to three leaf-ish elements keeps recalc under ~15 nodes. Spring settle in rAF (rather than a CSS transition of --a) allows interrupting a settling page by grabbing it and gives the under-damped flutter at landing. CSS trig (sin/cos/max) is supported by the assumed engines; a JS shadeFor(angle) fallback writes --shade-f/--shade-b/--cast if CSS.supports('opacity: calc(sin(1deg))') is false.
- **topic**: Drag-to-flip pointer mapping | **decision**: pointerdown inside a flip zone (outer 35% of a page, or anywhere with Alt) captures the pointer, reads bookRoot.getBoundingClientRect() once to get spineX, records r = |x0 - spineX| (distance from the gutter to the grab point). Each move: a = -acos(clamp((x - spineX) / r, -1, 1)) in degrees (forward flip; mirrored for backward). Release: velocity from the last 4 samples (deg/s); commit if a < -90 or v < -250 deg/s (fling), else cancel; settle with the spring toward -180 or 0. Click (movement < 6px) on a flip zone = animated flip; click in the page center = FLIP into the editor. Keys: ArrowRight/Space/PageDown forward, ArrowLeft/PageUp back, Home/End first/last, Escape close. | **rationale**: With r = grab distance the grabbed point stays exactly under the finger and lands mirrored across the spine, so there is no jump at grab and the page never lags or leads the hand; the acos law gives fast lift near the edge and a slow approach through 90deg, which is what a real page does. One layout read per gesture start, none per move.
- **topic**: Closed-block thickness | **decision**: @property --thick { syntax: '<number>'; inherits: true; initial-value: 2 } on each .ob__block, set by React at flip end to clamp(2, pagesOnThatSide * 0.35, 26), transition: --thick 320ms ease-out. The block is a bottom page face at translateZ(calc(var(--thick) * -1px)), a fore-edge face (32px wide, page-lines gradient) at rotateY(90deg) scaleX(calc(var(--thick) / 32)) and a bottom edge face scaled the same way; the visible page faces sit at z=0. | **rationale**: Scaling fixed-size edge faces from a unitless number means the transition is pure transform/compositing with no width changes and no layout, and calc cannot divide by a length anyway.
- **topic**: Document on a page face | **decision**: .ob__doc is the read-only DocumentView (mode='page': no contenteditable, no handles, medium-size image variants) at the logical page size 840x1200, transform: scale(var(--page-scale)), transform-origin: 0 0, contain: strict, pointer-events: none. It renders when the sheet mounts (at flip end for the +2 sheet, prefetched in idle) and only re-renders when the document changes. Nothing inside it reads --a. Flip-zone and click targets are transparent overlays on the face, not the document. | **rationale**: Because the face is a 3D leaf with overflow hidden, Chrome/Safari rasterize it once and reuse the texture during the flip; any per-frame layout or React render inside would repaint a 2x-DPR 480x686 texture per frame per face. Same-tree rendering with the editor guarantees line-for-line parity for the FLIP.
- **topic**: FLIP page -> editor | **decision**: On click: from = faceEl.getBoundingClientRect(); flushSync mount of the editor overlay (fixed, opaque paper background, page at its final layout); to = editorPage.getBoundingClientRect(); compute dx/dy/sx/sy; editorPage.animate([{transform: translate(dx,dy) scale(sx,sy)}, {transform: none}], 420ms cubic-bezier(.2,.8,.2,1)) with transform-origin 0 0 and transient will-change; backdrop opacity 0->1 over 300ms; the spread stays mounted underneath and is hidden after the animation. Close reverses it against the target face's projected rect. No backdrop-filter on the backdrop. | **rationale**: WAAPI transform/opacity animations run on the compositor in Chrome, so a heavy editor mount cannot hitch the motion once it starts; two synchronous rect reads per gesture is within the zero-lag rule. The layer being animated is the editor page's own compositing layer (created by will-change), rasterized at its final 1:1 scale so text is crisp at rest.
- **topic**: Performance budget and will-change policy | **decision**: Shelf: <=150 composited layers at rest (30 books x 5 faces + plank segments + wall + label + hit strip); per scroll frame 2-3 transform writes, 0 layout reads, 0 paints except books entering the window (mounted in batches of <=4 per frame). Hover: <=6 elements' variables, no layout. Flip: <=12 layers moving, 1 variable write on <=3 elements per frame, 0 paint. Editor FLIP: 2 animated layers. will-change: transform permanently on .shelf__row, .shelf__hits, .shelf__labels only; transient on .book while hovered, on sheets while flipping, on the editor page while FLIPping; never on faces (3D transforms already promote them). No backdrop-filter or filter: blur anywhere inside or over the 3D stages; the settings popover uses a 96% opaque paper background. | **rationale**: Layer memory at 2x DPR is ~16 bytes per CSS pixel; 150 small book layers are under 20MB, the five open-book faces ~20MB. backdrop-filter over a 3D scene forces the scene to render into an intermediate texture and be read back every frame.
- **topic**: Safari and z-fighting rules | **decision**: Never put overflow (other than visible), clip-path, filter, opacity < 1, mask, mix-blend-mode, isolation or contain: paint on an element that is itself preserve-3d or sits between the perspective element and a face: Safari flattens the subtree. Keep perspective on the parent and preserve-3d on the child, never both on one element. backface-visibility: hidden goes on the face itself (also -webkit- prefixed). Never animate opacity on a book or sheet root; fade a face or an overlay instead. Coplanar faces are separated by >=1px translateZ (0.1px is inside Chrome's sort tolerance under perspective); every hidden side has backface-visibility hidden so it cannot compete. At rest, sheets snap to exact 0deg/-180deg and drop will-change so Safari re-rasterizes text at full quality. | **rationale**: These are the concrete flattening triggers in WebKit and the observed z-sort tolerance in Blink; following them removes the two classic failure modes (books collapsing to flat rectangles in Safari, shimmering page edges in Chrome).
- **topic**: Haptics honesty | **decision**: The shelf loop exposes onDetent(index, velocity) as scrollX crosses each spine boundary (throttled to >=35ms); the audio/feel module (out of scope here) subscribes. There is no trackpad haptic API in browsers; feel comes from the spring overshoot, scroll-snap proximity settling, and sound. | **rationale**: Stated as required by the brief; the rendering layer's job is to emit the events at the right moments with zero extra cost.

## HIDDENTRICKS
- **name**: Grab-point-exact page drag | **detail**: Angle = acos((pointerX - spineX) / r) where r is the distance from the gutter to where you grabbed; the grabbed point follows the finger along its own arc and lands mirrored across the spine. | **whyItFeelsGood**: No jump when you grab mid-page and no drift between hand and paper; the page feels attached to your fingertip, which is the single biggest difference between 'animation' and 'object'.
- **name**: Under-damped landing flutter | **detail**: Settle spring is k=170 with damping 0.9 of critical for sheets (k=110 for the cover), so a released page slightly overshoots -180deg and taps back; flings (< -250deg/s) commit even before 90deg. | **whyItFeelsGood**: Paper has mass; the faint bounce and the fling-to-commit are what make a flip read as a real sheet rather than a tween.
- **name**: Overshooting pull-out and leaning neighbours | **detail**: Hover uses cubic-bezier(.34,1.4,.64,1) over 300ms for the 44px lift plus 22deg swing, while the two neighbours lean away 4deg and slide 6px, the next pair at 40%. | **whyItFeelsGood**: The book pops rather than slides, and the shelf reacts to it like a real row of books being nudged apart.
- **name**: Label bubble choreography | **detail**: Small dot, big dot, then pill, staggered 60ms with a 1.15 overshoot ease; exit is one 120ms fade. | **whyItFeelsGood**: The label appears to rise out of the book like a thought instead of blinking on; the fast exit keeps skimming across spines from feeling laggy.
- **name**: Scroll settles on a spine | **detail**: When 'detents' is on, scroll-snap-type: x proximity with a snap point per book on the invisible spacer, so momentum ends with a book centered; the same boundary crossings emit the detent tick events. | **whyItFeelsGood**: You never stop half-way between two books, and each tick lines up with a spine passing the center, which is the closest a browser can get to trackpad detents.
- **name**: Thickness you can read | **detail**: Spine width comes from page count (16..56px) and the open-book's closed blocks grow/shrink on either side as you progress. | **whyItFeelsGood**: Long entries look heavy on the shelf and you feel how far into a book you are without a page counter.
- **name**: Resume riffle | **detail**: Opening a book plays the cover flip then riffles at most 6 intermediate sheets at 90ms each to land on the last-read spread (jumping if there are more). | **whyItFeelsGood**: The book opens where you left it, with a quick flutter that says 'I remembered', instead of a hard cut.
- **name**: Hover hysteresis | **detail**: 60ms grace on pointerout and a 1.6x widened hit slot for the active book; hit testing uses a flat strip, not the 3D faces. | **whyItFeelsGood**: No flicker of labels or pull-outs as the cursor grazes the boundary between two spines.
- **name**: Rubber-band without leaving the page | **detail**: overscroll-behavior-x: contain keeps native overscroll bounce at both ends of the shelf but stops the two-finger history swipe. | **whyItFeelsGood**: Hitting the end of the shelf feels like the OS, and it never accidentally navigates away.
- **name**: Crisp at rest, smooth in motion | **detail**: will-change is added at gesture start and removed on settle; sheets snap to exact 0/-180deg so the engines drop the 3D raster and re-render text at identity. | **whyItFeelsGood**: Motion never stutters, and the moment things stop the serif text is razor sharp again.
- **name**: The page becomes the editor | **detail**: The editor page renders the same DocumentView tree as the page face, so the WAAPI FLIP scales what looks like the same object from the spread into the full editor, lines matching. | **whyItFeelsGood**: Clicking a page does not open a different screen; the page you were looking at grows into your hands and is already editable when it lands.
- **name**: Cover opens and the book slides | **detail**: .ob__book's translateX is a cos() of the cover angle, so re-centering from one page width to the spread happens exactly in sync with the cover swinging open. | **whyItFeelsGood**: Nothing cuts or repositions; the book simply opens in your hands.

## RISKS
- **risk**: Safari flattens the 3D scene (books become flat rectangles) because some ancestor of the faces gets overflow/opacity/filter/contain:paint. | **mitigation**: Lint rule in CSS review: the only elements between .shelf__stage and a face are .shelf__row and .book, and both stay overflow: visible, opacity 1, no filter/mask/contain:paint; fades happen on faces or overlays. Same for .ob__book and .ob__sheet.
- **risk**: Hover flicker or lost hover when the pulled book's projected shape leaves its hit slot. | **mitigation**: Flat hit strip with scaleX(1.6) on the active slot and 60ms grace before clearing; slots are stable screen-space rectangles independent of the 3D geometry.
- **risk**: Native scroll event lags the compositor scroll by a frame, so the row appears to jitter against the wall. | **mitigation**: The spacer is invisible so a one-frame lag is not visible; where supported, scroll-driven animation binds the row to scrollLeft on the compositor with zero lag. The wall is static (no relative motion cue to expose lag).
- **risk**: Blurry or jittery text in 3D-transformed faces, especially Safari. | **mitigation**: Labels live outside the 3D tree; spine text uses text-shadow emboss to hide slight raster softness; sheets snap to exact angles and drop will-change at rest; document pages in the spread are for browsing at scale 0.5 and the FLIP hands off to a 1:1 editor layer.
- **risk**: Style recalc cost per flip frame if --a is inherited into DocumentView subtrees. | **mitigation**: --a is registered with inherits: false and written only on the flipping sheet and the two under-page cast elements; the document nodes never reference it.
- **risk**: Z-fighting between the flipping sheet and the pages beneath, or between covers and the top page. | **mitigation**: >=1px translateZ lifts for in-flight sheets (2px for the earlier of two), backface-visibility hidden on every face, at most two sheets in flight, non-live sheets visibility: hidden.
- **risk**: Memory/decode spikes when 200 image covers scroll past quickly. | **mitigation**: 320x480 thumbnails stored at import; window of ~30 books mounted; img.decode() prefetch one window ahead during idle; batch-mount at most 4 books per frame.
- **risk**: CSS trig / @property unsupported in an older WebKit. | **mitigation**: Feature-detect with CSS.supports('opacity: calc(sin(1deg))') and CSS.registerProperty presence; fallback path has JS write --shade-f/--shade-b/--cast per frame and sets --thick without transition.
- **risk**: Two-finger overscroll navigates back in Safari/Chrome. | **mitigation**: overscroll-behavior-x: contain on the scroller and on the body.
- **risk**: backdrop-filter on any UI over the shelf (settings popover, command bar) tanks frame rate. | **mitigation**: Solid 96% paper backgrounds; if a frosted look is ever wanted, pause shelf animation and set the stage to contain: paint while the popover is open (never while it animates).
- **risk**: React re-render during a flip (mounting the next sheet) causes a hitch. | **mitigation**: Sheet mounts only happen at flip end; the +2 sheet is prefetched in requestIdleCallback; Book3D and Sheet are memoized with stable props.

## CODESKETCHES
- **purpose**: Book3D component: one box, all geometry via CSS variables, never re-renders during scroll or hover
```
// Book3D.tsx
import { memo, CSSProperties } from 'react';
export const BOOK_H = 224, COVER_W = 152, GAP = 2;
export const spineWidth = (pages: number) => Math.round(Math.min(56, Math.max(16, 10 + pages * 2.2)));

export type Cover = { kind: 'solid' | 'gradient' | 'image'; color: string; color2?: string; angle?: number;
  thumbUrl?: string; titleStyle: 'band' | 'plain' | 'none'; ink: 'dark' | 'light' };

type Props = { id: string; x: number; spineW: number; title: string; cover: Cover;
  register: (id: string, el: HTMLElement | null) => void };

export const Book3D = memo(function Book3D({ id, x, spineW, title, cover, register }: Props) {
  const style = {
    '--x': x + 'px', '--spine-w': spineW + 'px',
    '--cover': cover.color, '--cover-2': cover.color2 ?? cover.color,
    '--cover-angle': (cover.angle ?? 180) + 'deg',
    '--ink': cover.ink === 'dark' ? 'var(--ink-dark)' : 'var(--ink-light)',
  } as CSSProperties;
  return (
    <div className='book' data-kind={cover.kind} data-thin={spineW < 14 || undefined}
         style={style} ref={el => register(id, el)} role='img' aria-label={title}>
      <div className='book__face book__spine'><span className='book__spineTitle'>{title}</span></div>
      <div className='book__face book__cover -front'>
        {cover.kind === 'image' && <img src={cover.thumbUrl} alt='' draggable={false} decoding='async' />}
        {cover.titleStyle !== 'none' && <div className={'book__title -' + cover.titleStyle}>{title}</div>}
      </div>
      <div className='book__face book__cover -back' />
      <div className='book__face book__top' />
      <div className='book__face book__shadow' />
    </div>
  );
});
// Hover is NOT a prop: the hit strip sets el.dataset.hover / --breathe through the registry.
```
- **purpose**: Book3D CSS: transform tree, materials, emboss, one plank shadow, vertical spine text
```
.shelf { --book-h: 224px; --cover-w: 152px; --shelf-y: 300px;
  --paper-noise: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .2 0 0 0 0 .15 0 0 0 0 .1 0 0 0 .07 0'/></filter><rect width='96' height='96' filter='url(%23n)'/></svg>");
  --page-lines: repeating-linear-gradient(90deg, #ece5d6 0 1px, #f7f2e8 1px 2.5px);
}
.book {
  --pull: 0; --breathe: 0;
  position: absolute; left: 0; top: calc(var(--shelf-y) - var(--book-h));
  width: var(--spine-w); height: var(--book-h);
  transform-style: preserve-3d;
  contain: layout style;                       /* never paint/strict: faces live outside this box */
  transform:
    translate3d(calc(var(--x) + var(--breathe) * 6px), 0, calc(var(--pull) * 44px))
    rotateY(calc(var(--pull) * -22deg + var(--breathe) * -4deg));
  transition: transform 260ms cubic-bezier(.22, 1, .36, 1);
}
.book[data-hover] { --pull: 1; will-change: transform; transition: transform 300ms cubic-bezier(.34, 1.4, .64, 1); }
@media (prefers-reduced-motion: reduce) {
  .book { transform: translate3d(var(--x), calc(var(--pull) * -14px), 0); }
}
.book__face { position: absolute; left: 0; top: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; }

/* spine: faces the viewer at z = +cover-w/2 */
.book__spine { width: var(--spine-w); height: 100%;
  transform: translateZ(calc(var(--cover-w) / 2));
  background:
    linear-gradient(90deg, rgba(0,0,0,.20), rgba(255,255,255,.10) 14%, rgba(255,255,255,0) 50%, rgba(0,0,0,.14)),
    var(--paper-noise),
    linear-gradient(var(--cover-angle), var(--cover), var(--cover-2)); }

/* covers: centred on the spine axis, then swung 90deg and pushed to x = spine-w (front) / x = 0 (back) */
.book__cover { width: var(--cover-w); height: 100%; left: calc(var(--spine-w) / 2 - var(--cover-w) / 2);
  background: linear-gradient(0deg, rgba(0,0,0,.06), rgba(0,0,0,.06)), var(--paper-noise),
              linear-gradient(var(--cover-angle), var(--cover), var(--cover-2)); overflow: hidden; }
.book__cover.-front { transform: rotateY(90deg)  translateZ(calc(var(--spine-w) / 2)); }
.book__cover.-back  { transform: rotateY(-90deg) translateZ(calc(var(--spine-w) / 2)); }
.book__cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.book__title.-band { position: absolute; left: 0; right: 0; bottom: 18%; padding: 10px 12px; background: var(--paper);
  font: 600 15px/1.2 var(--font-serif); color: var(--fg); letter-spacing: -.01em; }
.book__title.-plain { position: absolute; inset: auto 0 0; padding: 40px 12px 14px; color: var(--ink);
  background: linear-gradient(transparent, rgba(0,0,0,.45)); font: 600 15px/1.2 var(--font-serif); }

/* top edge: page block inset by the 2px boards; lit from above */
.book__top { width: var(--spine-w); height: var(--cover-w); top: calc(var(--book-h) / 2 - var(--cover-w) / 2);
  transform: rotateX(90deg) translateZ(calc(var(--book-h) / 2));
  border: 2px solid var(--cover); border-bottom: 0;      /* local bottom = spine side: pages meet the spine */
  background: linear-gradient(rgba(255,255,255,.18), rgba(255,255,255,.18)), var(--page-lines); background-clip: padding-box; }

/* the one shadow: a gradient face lying on the plank, moves and scales with the book */
.book__shadow { width: calc(var(--spine-w) + 40px); height: 176px; left: -20px; top: calc(var(--book-h) - 88px);
  transform: rotateX(90deg) scale(calc(1 + var(--pull) * .3));
  background: radial-gradient(closest-side, rgba(40,28,16,.55), rgba(40,28,16,0));
  opacity: calc(.28 + var(--pull) * .18); transition: opacity 260ms, transform 260ms; }

/* vertical spine title with emboss */
.book__spineTitle { position: absolute; inset: 14px 0 22px; margin: auto;
  writing-mode: vertical-rl; text-orientation: mixed;      /* reads top -> bottom like a real spine */
  font: 600 clamp(9px, calc(var(--spine-w) * .52), 15px)/1 var(--font-serif); letter-spacing: .01em;
  color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;
  text-shadow: 0 1px 0 rgba(255,255,255,.22), 0 -1px 0 rgba(0,0,0,.28); }
.book[data-thin] .book__spineTitle { display: none; }
```
- **purpose**: Shelf DOM + scroll->transform loop with windowing, detents, and scroll-timeline enhancement
```
// Shelf.tsx (structure)
// <div class='shelf' ref={scroller}>                      overflow-x:auto; overflow-y:hidden; overscroll-behavior-x:contain;
//   <div class='shelf__track' style={{width: rowW}}>     scrollbar-width:none; container-type:inline-size; scroll-snap-type: x proximity (detents on)
//     <div class='shelf__snaps'>{/* 1px snap points per book when detents are on */}</div>
//     <div class='shelf__stage'>                          position:sticky; left:0; width:100cqw; height:100%; perspective:1400px; perspective-origin:50% 30%
//       <div class='shelf__wall' />                       flat, translateZ(-120px) scale(1.09), static wall + shadow band
//       <div class='shelf__row' ref={row}>                transform-style:preserve-3d; will-change:transform
//         {plankSegments in window} {books in window}
//       </div>
//       <div class='shelf__hits' ref={hits}>{slots}</div> flat; will-change:transform
//       <div class='shelf__labels' ref={labels}>{label}</div>
//     </div>
//   </div>
// </div>

const OVERSCAN = 260;
function useLayout(entries: Entry[]) {                // prefix sums; only when entries change
  return useMemo(() => { const xs = new Float64Array(entries.length + 1); let x = 24;
    entries.forEach((e, i) => { xs[i] = x; x += spineWidth(e.pageCount) + GAP; });
    xs[entries.length] = x; return xs; }, [entries]);
}
function lowerBound(xs: Float64Array, v: number) { let lo = 0, hi = xs.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < v) lo = m + 1; else hi = m; } return lo; }

useEffect(() => {
  const sc = scroller.current!, rowEl = row.current!, hitsEl = hits.current!, labEl = labels.current!;
  const cssScroll = CSS.supports('animation-timeline: scroll()');
  sc.style.setProperty('--row-shift', Math.max(0, xs[n] - vw.current) + 'px');
  let raf = 0, lastX = 0, lastT = performance.now(), lastIdx = -1, lastTick = 0;
  const win = { first: -1, last: -1 };
  const frame = (now: number) => { raf = 0; const x = sc.scrollLeft;
    if (!cssScroll) { const t = 'translate3d(' + -x + 'px,0,0)'; rowEl.style.transform = t; hitsEl.style.transform = t; labEl.style.transform = t; }
    const idx = lowerBound(xs, x + vw.current / 2);                       // spine under the centre line
    if (idx !== lastIdx && now - lastTick > 35) { onDetent(idx, (x - lastX) / Math.max(1, now - lastT)); lastIdx = idx; lastTick = now; }
    lastX = x; lastT = now;
    const first = Math.max(0, lowerBound(xs, x - OVERSCAN) - 1);
    const last  = Math.min(n - 1, lowerBound(xs, x + vw.current + OVERSCAN));
    if (first !== win.first || last !== win.last) { win.first = first; win.last = last; setWindow({ first, last }); } // React only here
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(frame); };
  sc.addEventListener('scroll', onScroll, { passive: true });
  const ro = new ResizeObserver(([e]) => { vw.current = e.contentRect.width; onScroll(); }); ro.observe(sc);
  frame(performance.now());
  return () => { sc.removeEventListener('scroll', onScroll); ro.disconnect(); cancelAnimationFrame(raf); };
}, [xs]);

/* CSS enhancement: compositor-bound scroll, zero lag */
@supports (animation-timeline: scroll()) {
  .shelf__row, .shelf__hits, .shelf__labels { animation: rowScroll linear both; animation-timeline: scroll(nearest x); }
  @keyframes rowScroll { from { transform: translate3d(0,0,0) } to { transform: translate3d(calc(-1 * var(--row-shift)), 0, 0) } }
}
.shelf::-webkit-scrollbar { display: none; }
```
- **purpose**: Hover via flat hit strip: pull-out and neighbour breathing without React or layout
```
// registry: id -> book element (filled by Book3D's register prop)
const els = useRef(new Map<string, HTMLElement>());
let hovered: number | null = null, clearTimer = 0;
const BREATHE = [[-1, -1], [1, 1], [-2, -0.4], [2, 0.4]] as const;   // [offset, amount]

function applyHover(i: number | null) {
  if (hovered !== null) { const el = els.current.get(ids[hovered]); if (el) { delete el.dataset.hover; }
    for (const [d] of BREATHE) els.current.get(ids[hovered + d])?.style.setProperty('--breathe', '0');
    hitsEl.children[hovered - win.first]?.removeAttribute('data-active'); }
  hovered = i;
  if (i !== null) { const el = els.current.get(ids[i]); if (el) el.dataset.hover = '';
    for (const [d, amt] of BREATHE) els.current.get(ids[i + d])?.style.setProperty('--breathe', String(amt));
    hitsEl.children[i - win.first]?.setAttribute('data-active', '');
    setLabel({ id: ids[i], cx: xs[i] + spineWidth(entries[i].pageCount) / 2 });   // tiny React commit, label only
  } else setLabel(null);
}
hitsEl.addEventListener('pointerover', e => { const t = (e.target as HTMLElement).closest('.hit') as HTMLElement | null;
  if (!t) return; clearTimeout(clearTimer); applyHover(Number(t.dataset.i)); });
hitsEl.addEventListener('pointerleave', () => { clearTimer = window.setTimeout(() => applyHover(null), 60); });
els.current.forEach(el => el.addEventListener('transitionend', () => { if (!('hover' in el.dataset)) el.style.willChange = ''; }));

/* CSS */
.shelf__hits { position: absolute; inset: 0; will-change: transform; }
.hit { position: absolute; top: calc(var(--shelf-y) - var(--book-h) - 40px); height: calc(var(--book-h) + 48px);
  contain: strict; cursor: pointer; transform-origin: 50% 50%; }
.hit[data-active] { transform: scaleX(1.6); }       /* hysteresis: the active slot is wider than its spine */
```
- **purpose**: Label pill with the two-dot connector and staggered entrance
```
.shelf__labels { position: absolute; inset: 0; pointer-events: none; will-change: transform; }
.label { position: absolute; left: var(--cx); top: calc(var(--shelf-y) - var(--book-h) - 34px);
  transform: translate(-50%, calc(-1 * var(--pull, 1) * 10px));
  font: 500 13px/1 -apple-system, system-ui, sans-serif; color: var(--fg);
  background: var(--paper); border: 1px solid var(--hairline); border-radius: 999px; padding: 8px 12px;
  white-space: nowrap; box-shadow: 0 6px 18px -6px rgba(40,30,20,.25);
  animation: labelIn 240ms cubic-bezier(.2,.9,.3,1.15) 120ms both; }
.label::before, .label::after { content: ''; position: absolute; left: 50%; border-radius: 50%;
  background: var(--paper); border: 1px solid var(--hairline); animation: dotIn 200ms cubic-bezier(.2,.9,.3,1.2) both; }
.label::before { width: 9px; height: 9px; bottom: -13px; margin-left: -4.5px; animation-delay: 60ms; }
.label::after  { width: 5px; height: 5px; bottom: -22px; margin-left: -2.5px; animation-delay: 0ms; }
.label.-out { animation: labelOut 120ms ease-out both; }
@keyframes labelIn  { from { opacity: 0; transform: translate(-50%, 4px) scale(.85); } }
@keyframes dotIn    { from { opacity: 0; transform: scale(0); } }
@keyframes labelOut { to   { opacity: 0; } }
```
- **purpose**: Open-book CSS: sheets, hinge, faces, angle->shading in pure CSS trig, closed-block thickness, cover-driven centring
```
@property --a      { syntax: '<angle>';  inherits: false; initial-value: 0deg; }
@property --cover-a{ syntax: '<angle>';  inherits: true;  initial-value: 0deg; }
@property --thick  { syntax: '<number>'; inherits: true;  initial-value: 2; }

.ob { position: fixed; inset: 0; display: grid; place-items: center; background: var(--bg);
  perspective: 2400px; perspective-origin: 50% 42%; }
.ob__book { position: relative; width: 0; height: var(--page-h); transform-style: preserve-3d;
  /* closed => centred on one page (-W/2); open => centred on the spread (0) */
  transform: translateX(calc((1 + cos(var(--cover-a))) * var(--page-w) / -4)); }

.ob__sheet { position: absolute; left: 0; top: 0; width: var(--page-w); height: var(--page-h);
  transform-origin: 0 50%; transform-style: preserve-3d;
  transform: translateZ(var(--lift, 0px)) rotateY(var(--a)); visibility: hidden; }
.ob__sheet[data-live] { visibility: visible; }
.ob__sheet[data-flipping='1'] { --lift: 2px; will-change: transform; }   /* first in flight is physically on top */
.ob__sheet[data-flipping='2'] { --lift: 1px; will-change: transform; }

.ob__face { position: absolute; inset: 0; overflow: hidden; background: var(--paper);
  backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.ob__face.-back { transform: rotateY(180deg); }
.ob__gutter { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(to right, rgba(20,12,4,.10), transparent 6%); }
.ob__face.-back .ob__gutter { background: linear-gradient(to left, rgba(20,12,4,.10), transparent 6%); }

/* ---- angle -> shading. --a runs 0deg (flat right) to -180deg (flat left). -sin(--a): 0 -> 1 -> 0 ---- */
.shade { position: absolute; inset: 0; pointer-events: none; }
.ob__face.-front > .shade { background: linear-gradient(to right, rgba(20,12,4,.55), rgba(20,12,4,0) 45%);
  opacity: calc(-1 * sin(var(--a)) * .8); }
.ob__face.-back  > .shade { background: linear-gradient(to left, rgba(20,12,4,.50), rgba(20,12,4,0) 40%, rgba(255,255,255,.35) 95%);
  opacity: calc(-1 * sin(var(--a)) * .7); }
/* cast shadow on the pages beneath: width = projection of the sheet, darkness = lift */
.ob__under { position: absolute; top: 0; width: var(--page-w); height: var(--page-h); pointer-events: none; overflow: hidden; }
.ob__under.-right { left: 0; }  .ob__under.-left { left: calc(-1 * var(--page-w)); }
.ob__under > .cast { position: absolute; inset: 0; opacity: calc(-1 * sin(var(--a))); }
.ob__under.-right > .cast { transform-origin: 0 50%;   transform: scaleX(max(0, cos(var(--a))));
  background: linear-gradient(to right, rgba(20,12,4,.35), rgba(20,12,4,0)); }
.ob__under.-left  > .cast { transform-origin: 100% 50%; transform: scaleX(max(0, -1 * cos(var(--a))));
  background: linear-gradient(to left,  rgba(20,12,4,.35), rgba(20,12,4,0)); }

/* ---- closed blocks: thickness is a number, edges are fixed 32px faces scaled by it ---- */
.ob__block { position: absolute; top: 0; width: var(--page-w); height: var(--page-h); transform-style: preserve-3d;
  transition: --thick 320ms ease-out; }
.ob__block.-right { left: 0; } .ob__block.-left { left: calc(-1 * var(--page-w)); }
.ob__block > .bottom { position: absolute; inset: 0; background: var(--paper); transform: translateZ(calc(var(--thick) * -1px)); }
.ob__block > .edge   { position: absolute; top: 0; width: 32px; height: 100%; background: var(--page-lines); }
.ob__block.-right > .edge { left: calc(var(--page-w) - 16px); transform: translateX(16px) rotateY(90deg)  translateZ(calc(var(--thick) * -0.5px)) scaleX(calc(var(--thick) / 32)); transform-origin: 50% 50%; }
.ob__block.-left  > .edge { left: -16px;                       transform: translateX(-16px) rotateY(-90deg) translateZ(calc(var(--thick) * -0.5px)) scaleX(calc(var(--thick) / 32)); }
.ob__block > .foot   { position: absolute; left: 0; width: 100%; height: 32px; top: calc(var(--page-h) - 16px);
  background: var(--page-lines); transform: rotateX(-90deg) translateZ(calc(var(--thick) * -0.5px)) scaleY(calc(var(--thick) / 32)); }

/* ---- the document on the face ---- */
.ob__doc { width: var(--doc-w, 840px); height: var(--doc-h, 1200px); transform: scale(var(--page-scale)); transform-origin: 0 0;
  contain: strict; pointer-events: none; user-select: none; }
.ob__zone { position: absolute; top: 0; bottom: 0; width: 35%; cursor: grab; }
.ob__face.-front > .ob__zone { right: 0; } .ob__face.-back > .ob__zone { left: 0; }
```
- **purpose**: Flip controller: grab-point-exact drag mapping, spring settle, lifecycle without z-index
```
type Flip = { sheet: HTMLElement; unders: HTMLElement[]; a: number; v: number; raf: number; dir: 1 | -1; slot: 1 | 2 };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
function writeAngle(f: Flip, a: number) { f.a = a; const s = a + 'deg';
  f.sheet.style.setProperty('--a', s); for (const u of f.unders) u.style.setProperty('--a', s); }

// drag mapping: the point you grabbed (distance r from the gutter) stays under the finger on its own arc
const angleFromPointer = (x: number, spineX: number, r: number) =>
  -Math.acos(clamp((x - spineX) / r, -1, 1)) * 180 / Math.PI;                 // 0 .. -180 (forward)

function settle(f: Flip, target: number, v0: number, k = 170, zeta = 0.9) {
  f.v = v0; let last = performance.now(); const c = 2 * Math.sqrt(k) * zeta;
  const step = (now: number) => { const dt = Math.min(32, now - last) / 1000; last = now;
    const acc = -k * (f.a - target) - c * f.v; f.v += acc * dt; writeAngle(f, f.a + f.v * dt);
    if (Math.abs(f.a - target) > 0.15 || Math.abs(f.v) > 2) f.raf = requestAnimationFrame(step);
    else { writeAngle(f, target); endFlip(f, target === (f.dir === 1 ? -180 : 0) ? 'commit' : 'cancel'); } };
  cancelAnimationFrame(f.raf); f.raf = requestAnimationFrame(step);
}

// lifecycle: sheets[cur] is the right page's sheet; sheets[cur-1].back is the left page
function beginFlip(dir: 1 | -1): Flip | null {
  if (inFlight.length >= 2) { queue.push(dir); return null; }
  const i = dir === 1 ? cur : cur - 1; const sheet = sheetEl(i); if (!sheet) return null;
  const slot = inFlight.length === 0 ? 1 : 2;
  sheet.dataset.flipping = String(slot); sheet.dataset.live = '';
  const underR = sheetEl(i + 1), underL = sheetEl(i - 1);            // pages that become visible beneath
  if (underR) underR.dataset.live = '';  if (underL) underL.dataset.live = '';
  const f: Flip = { sheet, unders: [castR, castL], a: dir === 1 ? 0 : -180, v: 0, raf: 0, dir, slot };
  inFlight.push(f); return f;
}
function endFlip(f: Flip, result: 'commit' | 'cancel') {
  delete f.sheet.dataset.flipping; f.sheet.style.willChange = '';
  inFlight.splice(inFlight.indexOf(f), 1);
  if (result === 'commit') cur += f.dir;                              // React commit happens here, not mid-flip
  setCurrent(cur);                                                    // remounts window cur-2..cur+2, hides others
  if (queue.length) startFlip(queue.shift()!);
}

// pointer handling (on the .ob root, delegated)
let drag: { f: Flip; spineX: number; r: number; x0: number; samples: [number, number][] } | null = null;
root.addEventListener('pointerdown', e => { const zone = (e.target as HTMLElement).closest('.ob__zone'); if (!zone) return;
  const dir: 1 | -1 = zone.parentElement!.classList.contains('-front') ? 1 : -1;
  const f = beginFlip(dir); if (!f) return; root.setPointerCapture(e.pointerId);
  const rect = bookRoot.getBoundingClientRect();                     // the one layout read of this gesture
  const spineX = rect.left; const r = Math.max(40, Math.abs(e.clientX - spineX));
  drag = { f, spineX, r, x0: e.clientX, samples: [[e.timeStamp, f.a]] }; });
root.addEventListener('pointermove', e => { if (!drag) return; const { f, spineX, r } = drag;
  const a = f.dir === 1 ? angleFromPointer(e.clientX, spineX, r) : -180 - angleFromPointer(2 * spineX - e.clientX, spineX, r);
  writeAngle(f, a); drag.samples.push([e.timeStamp, a]); if (drag.samples.length > 4) drag.samples.shift(); });
root.addEventListener('pointerup', e => { if (!drag) return; const { f, samples, x0 } = drag; drag = null;
  const [t0, a0] = samples[0], [t1, a1] = samples[samples.length - 1];
  const v = (a1 - a0) / Math.max(1, t1 - t0) * 1000;                  // deg/s
  if (Math.abs(e.clientX - x0) < 6) { settle(f, f.dir === 1 ? -180 : 0, 0); return; }   // plain click = animated flip
  const past = f.dir === 1 ? f.a < -90 : f.a > -90; const fling = f.dir === 1 ? v < -250 : v > 250;
  settle(f, (past || fling) ? (f.dir === 1 ? -180 : 0) : (f.dir === 1 ? 0 : -180), v); });

// JS fallback when CSS trig is unavailable: write the shade variables the CSS would have computed
export function shadeFor(aDeg: number) { const s = -Math.sin(aDeg * Math.PI / 180), c = Math.cos(aDeg * Math.PI / 180);
  return { shadeF: s * .8, shadeB: s * .7, cast: s, castR: Math.max(0, c), castL: Math.max(0, -c) }; }
```
- **purpose**: FLIP from the page face in the spread to the full editor (WAAPI, compositor-driven)
```
async function openEditor(faceEl: HTMLElement, pageId: string) {
  const from = faceEl.getBoundingClientRect();                       // layout read #1: projected rect of the 3D face
  flushSync(() => setEditor({ pageId, entering: true }));           // mount editor overlay at its final layout
  const page = editorPageRef.current!, backdrop = backdropRef.current!;
  const to = page.getBoundingClientRect();                           // layout read #2 (forced once, after commit)
  const dx = from.left - to.left, dy = from.top - to.top;
  const sx = from.width / to.width, sy = from.height / to.height;    // equal: same 840x1200 logical page
  page.style.transformOrigin = '0 0'; page.style.willChange = 'transform';
  const move = page.animate(
    [{ transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')' }, { transform: 'none' }],
    { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
  backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out', fill: 'both' });
  await move.finished;
  move.cancel(); page.style.willChange = ''; page.style.transformOrigin = '';
  setEditor(s => ({ ...s, entering: false }));                       // now hide the spread beneath
}
// Editor page and .ob__doc render the same <DocumentView> tree (editor mode vs page mode), so lines match during the scale.
// The backdrop is an opaque paper layer (no backdrop-filter) so the 3D spread underneath is never re-sampled per frame.
```

