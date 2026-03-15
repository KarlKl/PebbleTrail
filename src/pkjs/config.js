module.exports = [
  {
    type: "heading",
    defaultValue: "PebbleTrail Configuration",
  },
  {
    type: "text",
    defaultValue:
      "Configure your PebbleTrail watchface settings below. Changes will be sent to your watch immediately.",
  },
  {
    type: "section",
    items: [
      {
        type: "heading",
        defaultValue: "Map Appearance",
      },
      {
        type: "toggle",
        messageKey: "showCurrentLocationDot",
        defaultValue: true,
        label: "Show Current Location Dot",
      },
      {
        type: "select",
        messageKey: "tileProvider",
        defaultValue: "stamen_toner",
        label: "Map Provider",
        options: [
          { label: "OpenStreetMap", value: "osm" },
          { label: "CyclOSM", value: "osm_cyclosm" },
          { label: "Stamen Watercolor", value: "stamen_watercolor" },
          { label: "Stamen Toner", value: "stamen_toner" },
          { label: "Stamen Terrain", value: "stamen_terrain" },
        ],
      },
      {
        type: "text",
        defaultValue:
          '&copy; <a href="https://stadiamaps.com/" target="_blank">Stadia Maps</a><br>&copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a><br>&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      },
      {
        type: "slider",
        messageKey: "zoomLevel",
        defaultValue: 16,
        label: "Start Zoom Level",
        min: 0,
        max: 20,
        step: 1,
      },
    ],
  },
  {
    type: "section",
    items: [
      {
        type: "heading",
        defaultValue: "Performance",
      },
      {
        type: "text",
        defaultValue:
          "You can switch to black and white rendering to speed up tile rendering and save battery.",
        capabilities: ["COLOR"],
      },
      {
        type: "toggle",
        messageKey: "enforceMonochrome",
        defaultValue: false,
        label: "Black &amp; White Tiles",
        capabilities: ["COLOR"],
      },
      {
        type: "text",
        defaultValue:
          "The watchface will fetch new map tiles at the interval you specify here. Setting a shorter interval will make the watchface more responsive to location changes, but will also consume more battery and data.",
      },
      {
        type: "slider",
        messageKey: "updateIntervalSeconds",
        defaultValue: 60,
        label: "Tile Update Interval (seconds)",
        min: 10,
        max: 300,
        step: 10,
      },
      {
        type: "text",
        defaultValue:
          "Enabling this option will make the watchface only fetch new tiles when you press the select button. This can help save battery if you don't need the map to update in real time.",
      },
      {
        type: "toggle",
        messageKey: "onlyUpdateOnSelectPress",
        defaultValue: false,
        label: "Only Update When Select Button is Pressed",
      },
    ],
  },
  {
    type: "section",
    items: [
      {
        type: "heading",
        defaultValue: "GPX",
      },
      {
        type: "color",
        messageKey: "gpxTrackColor",
        label: "GPX Track Color",
        defaultValue: "0000FF",
        capabilities: ["COLOR"],
      },
      {
        type: "select",
        messageKey: "gpxLineStyle",
        label: "GPX Track Line Style",
        defaultValue: "[5,5]",
        options: [
          { label: "Solid", value: "[]" },
          { label: "Dashed", value: "[5,5]" },
          { label: "Dotted", value: "[1,2]" },
        ],
      },
      {
        type: "text",
        defaultValue: "For better visibility, especially on monochrom watches, you can set the GPX line style to Dashed or Dotted above."
      },
      {
        type: "text",
        defaultValue:
          "Enter the URL of a GPX file to have its track points displayed on the watchface. OR paste the gpx file as text.",
      },
      {
        type: "input",
        messageKey: "gpxUrl",
        label: "GPX URL",
        defaultValue: "",
      },
      {
        type: "input",
        messageKey: "gpxText",
        label: "GPX Text",
        defaultValue: "",
      },
    ],
  },
  {
    type: "section",
    items: [
      {
        type: "heading",
        defaultValue: "Map Overlays",
      },
      {
        type: "toggle",
        messageKey: "showTime",
        defaultValue: true,
        label: "Show Current Time*",
      },
      {
        type: "text",
        defaultValue: "*Changing this setting needs restart of watchapp.",
      },
      {
        type: "toggle",
        messageKey: "showZoomLevel",
        defaultValue: false,
        label: "Show Zoom Level",
      },
      {
        type: "toggle",
        messageKey: "showZoomButtons",
        defaultValue: true,
        label: "Show Zoom Buttons",
      },
    ],
  },
  {
    type: "submit",
    defaultValue: "Save Settings",
  },
];
