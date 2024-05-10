## 0.2.1

Updated dependecies.

## 0.2.0

*Breaking:* Fixed some `fill="none"` issues. Unjunk now assumes that if you have `fill`, `color`, or `background` set explicitly then you don't want to override it.

*Breaking:* `xlink:href` is now replaced with `href`. Only affects ancient SVG viewers.

Fixed: Unjunk could previously corrupt thin strokes. Stroke related changes are now checked in a lossless manner.

Updated dependencies.

Fix excessive image data cache memory footprint.

`xmlns` is no longer required on a root element. It will be present in the output though.

The attribute order is now kept. Previously `xmlns` was always moved in front.

## 0.1.0

Initial public release
