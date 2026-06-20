import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { discoverContentAssetUrls } from "../../../../lib/media-urls.js";
import {
  applyStructuralLayoutMap,
  flattenWordPressBuilders,
  looksLikeContactFormHtml,
  normalizeVideoEmbedUrl,
  parseFractionWidth,
  parseRowLayoutCols,
} from "../../../../parsers/wordpress/builders/flatten.js";
import { findWordPressShortcodeMarkers } from "../../../../parsers/wordpress/builders/shortcode-conflicts.js";
import {
  extendedPrefixedLayoutMap,
  fractionalLayoutMap,
  parseFractionalColumnWidth,
  prefixedLayoutMap,
  type BuilderThemeConfig,
} from "../../../../parsers/wordpress/builders/registry.js";

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../../fixtures/wordpress");

function extractAboutPageRawContent(): string {
  const xml = readFileSync(join(FIXTURES_ROOT, "naikonpixels.WordPress.Pages.2026-06-09.xml"), "utf8");
  const match = xml.match(
    /<link>[^<]*\/about\/<\/link>[\s\S]*?<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/,
  );
  if (!match?.[1]) throw new Error("about page content not found in fixture");
  return match[1];
}

describe("flattenWordPressBuilders", () => {
  it("converts Tatsu structure to data-layout markers and image shortcodes", () => {
    const raw =
      '[tatsu_section padding="0"][tatsu_row layout="1/2+1/2"][tatsu_column][tatsu_text]Hello[/tatsu_text]' +
      '[tatsu_image image= "https://example.com/wp-content/uploads/2022/05/MoccasinCreek_w_1045.jpg" id= "4507"][/tatsu_image]' +
      "[/tatsu_column][/tatsu_row][/tatsu_section]";

    const { html, detectedThemes } = flattenWordPressBuilders(raw);

    expect(detectedThemes).toContain("tatsu");
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-layout="row"');
    expect(html).toContain('data-cols="2"');
    expect(html).toContain('data-layout="column"');
    expect(html).toContain('<img src="https://example.com/wp-content/uploads/2022/05/MoccasinCreek_w_1045.jpg"');
    expect(html).not.toMatch(/\[tatsu_/);
    expect(html).toContain("Hello");
    expect(discoverContentAssetUrls(html)).toHaveLength(1);
  });

  it("parses row layout strings into column counts", () => {
    expect(parseRowLayoutCols("1/2+1/2")).toBe(2);
    expect(parseRowLayoutCols("1/3+1/3+1/3")).toBe(3);
    expect(parseRowLayoutCols("1/1")).toBeUndefined();
  });

  it("parses fractional width strings into percentages", () => {
    expect(parseFractionWidth("1/1")).toBe("100%");
    expect(parseFractionWidth("1/2")).toBe("50%");
    expect(parseFractionWidth("1/3")).toBe("33.33%");
    expect(parseFractionWidth("2/3")).toBe("66.67%");
  });

  it("applies layoutMap dynamically for any namespace via the generic compiler", () => {
    const raw =
      '[vc_section bg_image="https://example.com/hero.jpg"][vc_row layout="1/2+1/2"]' +
      '[vc_column]<p>Left</p>[/vc_column][vc_column]<p>Right</p>[/vc_column][/vc_row][/vc_section]';

    const map = prefixedLayoutMap({
      section: "vc_section",
      row: "vc_row",
      column: "vc_column",
      bgParamName: "bg_image",
      colsParamName: "layout",
    });
    const html = applyStructuralLayoutMap(raw, map);

    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-bg-image="https://example.com/hero.jpg"');
    expect(html).toContain('data-cols="2"');
    expect(html).toContain('data-layout="column"');
    expect(html).toContain("<p>Left</p>");
    expect(html).not.toMatch(/\[vc_/);
  });

  it("uses registry layoutMap for Divi without Tatsu-specific code", () => {
    const raw =
      '[et_pb_section][et_pb_row layout="1/2+1/2"][et_pb_column][et_pb_image src="https://example.com/wp-content/uploads/divi.jpg"][/et_pb_image][/et_pb_column][/et_pb_row][/et_pb_section]';
    const diviOnly: BuilderThemeConfig[] = [
      {
        id: "divi",
        detect: /\[(?:\/)?et_pb_/i,
        layoutMap: prefixedLayoutMap({
          section: "et_pb_section",
          row: "et_pb_row",
          column: "et_pb_column",
        }),
        urlRules: [{ shortcodePrefix: "et_pb_image", urlParams: ["src", "url"], tag: "img" }],
        scaffoldingPrefixes: ["et_pb_"],
      },
    ];
    const { html } = flattenWordPressBuilders(raw, { registry: diviOnly });
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-layout="row"');
    expect(html).toContain('data-cols="2"');
    expect(html).toContain('<img src="https://example.com/wp-content/uploads/divi.jpg"');
    expect(html).not.toMatch(/\[et_pb_/);
  });

  it("flattens naikonpixels about page with section/row/column structure", () => {
    const { html, detectedThemes } = flattenWordPressBuilders(extractAboutPageRawContent());

    expect(detectedThemes).toContain("tatsu");
    expect(detectedThemes).toContain("oshine");
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-bg-image="https://75b6txrbn2.execute-api.us-west-2.amazonaws.com/prod/wp-content/uploads/About_w_2048.jpg"');
    expect(html).toContain('data-cols="2"');
    expect(html).toContain('data-cols="3"');
    expect(html).toContain("<p>I am Prashant Naik.");
    expect(html).toContain("International Dark-Sky Association");
    expect(html).toContain('data-wp-widget="map"');
    expect(html).toContain("IDA-Logo-Full.png");
    expect(html).toContain("NYCIndieff.jpeg");
    expect(html).toContain("Explore-Georgia.png");
    expect(html).not.toMatch(/\[tatsu_/);
    expect((html.match(/data-layout="row"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((html.match(/data-layout="column"/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("leaves plain HTML unchanged when no builder detected", () => {
    const html = "<p>Plain post</p><img src=\"https://example.com/wp-content/uploads/a.jpg\" />";
    const result = flattenWordPressBuilders(html);
    expect(result.html).toBe(html);
    expect(result.detectedThemes).toEqual([]);
  });

  it("converts Divi et_pb_image src attributes with structural layoutMap", () => {
    const raw =
      '[et_pb_section][et_pb_row][et_pb_image src="https://example.com/wp-content/uploads/divi.jpg"][/et_pb_image][/et_pb_row][/et_pb_section]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('<img src="https://example.com/wp-content/uploads/divi.jpg"');
    expect(html).not.toMatch(/\[et_pb_/);
  });

  it("converts Oshine special_sub_title title_content to paragraphs", () => {
    const raw =
      '[special_sub_title title_content= "I am Prashant Naik." font_size= "18"][/special_sub_title]' +
      '<h5>Existing heading</h5>';
    const { html, detectedThemes } = flattenWordPressBuilders(raw);
    expect(detectedThemes).toContain("oshine");
    expect(html).toContain("<p>I am Prashant Naik.</p>");
    expect(html).not.toMatch(/\[special_sub_title/);
    expect(html).toContain("<h5>Existing heading</h5>");
  });

  it("converts special_heading5 caption_content and strips grids scaffolding", () => {
    const raw =
      '[special_heading5 title_content= "" caption_content= "Awards and Recognition"][/special_heading5]' +
      '[grids column= "3"][grid_content]<h6>Gold</h6><p>IPA 2022</p>[/grid_content][/grids]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain("<h4>Awards and Recognition</h4>");
    expect(html).toContain("<h6>Gold</h6>");
    expect(html).not.toMatch(/\[grids|\[grid_content/);
  });

  it("preserves testimonial inner HTML and converts author_image", () => {
    const raw =
      '[testimonials][testimonial author_image= "https://example.com/wp-content/uploads/face.jpg" author= "Jane"]' +
      "<p>Great photographer.</p>[/testimonial][/testimonials]";
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('<img src="https://example.com/wp-content/uploads/face.jpg"');
    expect(html).toContain("<p>Great photographer.</p>");
    expect(html).not.toMatch(/\[testimonial|\[testimonials/);
  });

  it("preserves testimonial author_image when export HTML-encodes quotes", () => {
    const raw =
      "[testimonials][testimonial author_image= &quot;https://example.com/wp-content/uploads/face.jpg&quot; author= &quot;Jane&quot;]" +
      "<p>Great photographer.</p>[/testimonial][/testimonials]";
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('<img src="https://example.com/wp-content/uploads/face.jpg"');
    expect(html).toContain("<p>Great photographer.</p>");
    expect(html).not.toMatch(/\[testimonial|\[testimonials/);
  });

  it("replaces blox_gmap with a map widget stub", () => {
    const raw = '[blox_gmap type="gmap"]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-wp-widget="map"');
    expect(html).not.toMatch(/\[blox_gmap/);
  });

  it("blox_gmap address → map stub with data-embed-url", () => {
    const raw = '[blox_gmap type="gmap" address= "Atlanta, GA"]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-wp-widget="map"');
    expect(html).toContain('data-embed-url="https://maps.google.com/maps?q=Atlanta%2C%20GA&amp;output=embed"');
    expect(html).toContain('data-wp-map-query="Atlanta, GA"');
  });

  it("tatsu_map lat/lng → map stub with data-embed-url", () => {
    const raw = '[tatsu_map lat= "33.749" lng= "-84.388" zoom= "12"]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-embed-url="https://maps.google.com/maps?q=33.749%2C-84.388&amp;z=12&amp;output=embed"');
    expect(html).toContain('data-wp-map-lat="33.749"');
    expect(html).toContain('data-wp-map-lng="-84.388"');
  });

  it("flattens blox_gmap nested in tatsu_text_with_shortcodes", () => {
    const raw =
      '[tatsu_text_with_shortcodes][blox_gmap type="gmap" address= "Decatur, GA"][/tatsu_text_with_shortcodes]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-wp-widget="map"');
    expect(html).toContain("Decatur");
    expect(html).not.toMatch(/\[blox_gmap/);
  });

  it("affiliation tatsu_icon in columns → linked img HTML", () => {
    const raw =
      '[tatsu_section][tatsu_row layout= "1/3+1/3+1/3"][tatsu_column][tatsu_icon icon_image= "https://example.com/wp-content/uploads/IDA.png" href= "https://darksky.org/"][/tatsu_icon][/tatsu_column][/tatsu_row][/tatsu_section]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-cols="3"');
    expect(html).toContain('<a href="https://darksky.org/">');
    expect(html).toContain("IDA.png");
    expect(html).not.toMatch(/\[tatsu_icon/);
  });

  it("converts Blox prefixed row/column/inner tokens to data-layout markers", () => {
    const raw =
      '[blox_row color="#f5f5f5"][blox_column width="1/1"][blox_row_inner columns="1/1"]' +
      '[blox_column_inner width="1/1"][blox_text]<h3>Dedicated</h3>[/blox_text][/blox_column_inner][/blox_row_inner][/blox_column][/blox_row]';
    const { html, detectedThemes } = flattenWordPressBuilders(raw);

    expect(detectedThemes).toContain("oshine");
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-layout="row"');
    expect(html).toContain('data-layout="column" data-col-width="100%"');
    expect(html).toContain("<h3>Dedicated</h3>");
    expect(html).not.toMatch(/\[blox_/);
  });

  it("registers WPBakery vc_ structural tokens via extended prefixed layoutMap", () => {
    const raw =
      '[vc_section bg_image="https://example.com/hero.jpg"][vc_row layout="1/2+1/2"]' +
      '[vc_column width="1/2"]<p>Left</p>[/vc_column][vc_column_inner width="1/2"]<p>Right</p>[/vc_column_inner][/vc_row][/vc_section]';
    const { html, detectedThemes } = flattenWordPressBuilders(raw);

    expect(detectedThemes).toContain("wpbakery");
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-bg-image="https://example.com/hero.jpg"');
    expect(html).toContain('data-cols="2"');
    expect(html).toContain('data-layout="column" data-col-width="50%"');
    expect(html).not.toMatch(/\[vc_/);
  });

  it("flattens Tatsu/Oshine [blog] to blog-listing widget stub", () => {
    const raw =
      '[tatsu_section][tatsu_row][tatsu_column][blog col= "three" number_of_posts= "10" filter_by= "category" categories= "" tags= ""][/blog][/tatsu_column][/tatsu_row][/tatsu_section]';
    const { html, detectedThemes } = flattenWordPressBuilders(raw);
    expect(detectedThemes).toContain("tatsu");
    expect(html).toContain('data-wp-widget="blog-listing"');
    expect(html).toContain('data-wp-blog-layout="grid"');
    expect(html).toContain('data-wp-blog-limit="10"');
    expect(html).toContain('data-wp-blog-columns="three"');
    expect(html).not.toMatch(/\[blog\b/);
  });

  it("maps builderLayout=list on [blog] to list layout attr", () => {
    const raw = '[blog builderLayout= "list" number_of_posts= "6"][/blog]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-wp-widget="blog-listing"');
    expect(html).toContain('data-wp-blog-layout="list"');
    expect(html).toContain('data-wp-blog-limit="6"');
  });

  it("flattens Oshine [recent_posts] to blog-listing widget stub", () => {
    const raw =
      '[recent_posts number= "three" filter_by= "category" categories= "" tags= ""][/recent_posts]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-wp-widget="blog-listing"');
    expect(html).toContain('data-wp-blog-limit="3"');
    expect(html).not.toMatch(/\[recent_posts\b/);
  });

  it("strips blox_row scaffolding and flattens portfolio to widget stub", () => {
    const raw =
      '[blox_row][blox_column width="1/1"][portfolio col="two" category="photography"][/portfolio][/blox_column][/blox_row]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-layout="column"');
    expect(html).not.toMatch(/\[blox_/);
    expect(html).toContain('data-wp-widget="portfolio"');
    expect(html).toContain('data-wp-portfolio-category="photography"');
    expect(html).not.toMatch(/\[portfolio/);
  });

  it("expands inline [gallery ids] to attachment img stubs (not portfolio widget)", () => {
    const raw = '[gallery ids="142,143,144"]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-wp-inline-gallery');
    expect(html).toContain('data-wp-attachment-id="142"');
    expect(html).toContain('data-wp-attachment-id="144"');
    expect(html).not.toContain('data-wp-widget="portfolio"');
    expect(html).not.toMatch(/\[gallery/);
  });

  it("expands [oshine_gallery ids] to inline attachment markers", () => {
    const raw = '[oshine_gallery image_source= "selected" ids= "4931,4932,4928"]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-wp-inline-gallery');
    expect(html).toContain('data-wp-attachment-id="4931"');
    expect(html).toContain('data-wp-attachment-id="4928"');
    expect(html).not.toMatch(/\[oshine_gallery/);
  });

  it("emits portfolio widget stub for dynamic [gallery] without ids", () => {
    const raw = '[gallery category="photography"]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-wp-widget="portfolio"');
    expect(html).toContain('data-wp-gallery-dynamic="1"');
    expect(html).not.toMatch(/\[gallery/);
  });

  it("flattens contact-form-7 to contact-form widget stub", () => {
    const raw = '[contact-form-7 id="123" title="Contact"]';
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-wp-widget="contact-form"');
    expect(html).toContain('data-wp-form-source="contact-form-7"');
    expect(html).toContain('data-wp-form-id="123"');
    expect(html).not.toMatch(/\[contact-form-7/);
  });

  it("tatsu_code custom HTML form → contact-form widget stub", () => {
    const raw =
      '[tatsu_section][tatsu_row][tatsu_column][tatsu_code key= "ZJRV6OZlH"]' +
      '<form id="serverless-contact-form"><input class="form-name" name="form-name" type="text" placeholder="Your Name">' +
      '<input class="form-email" name="form-email" type="text" placeholder="Email">' +
      '<textarea class="form-message" name="form-message" placeholder="Message"></textarea>' +
      '<div class="g-recaptcha" data-sitekey="abc"></div>' +
      '<input class="form-submit" type="submit" value="Submit"></form>[/tatsu_code]' +
      '[tatsu_code key= "0waXqoShu"]<script src="https://www.example.com/scripts/contact_form_lambda.js"></script>' +
      '<script src="https://www.google.com/recaptcha/api.js"></script>[/tatsu_code]' +
      "[/tatsu_column][/tatsu_row][/tatsu_section]";
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-wp-widget="contact-form"');
    expect(html).toContain('data-wp-form-source="custom-html"');
    expect(html).toContain('data-wp-form-id="serverless-contact-form"');
    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/recaptcha|contact_form_lambda/i);
    expect(html).not.toMatch(/\[tatsu_code/);
  });

  it("looksLikeContactFormHtml rejects login and newsletter-only forms", () => {
    expect(
      looksLikeContactFormHtml('<form id="loginform"><input name="log"><input name="pwd"></form>'),
    ).toBe(false);
    expect(
      looksLikeContactFormHtml('<form id="newsletter"><input name="email" type="email"></form>'),
    ).toBe(false);
    expect(
      looksLikeContactFormHtml(
        '<form id="contact"><input name="email" type="email"><textarea name="message"></textarea></form>',
      ),
    ).toBe(true);
  });

  it("normalizes YouTube watch URLs to youtube-nocookie embed (OSS-16)", () => {
    expect(normalizeVideoEmbedUrl("https://youtube.com/watch?v=ABC123xyz&t=45s")).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube-nocookie.com/embed/ABC123xyz?start=45",
    });
    expect(normalizeVideoEmbedUrl("https://youtu.be/ABC123xyz?feature=shared")).toEqual({
      provider: "youtube",
      embedUrl: "https://www.youtube-nocookie.com/embed/ABC123xyz",
    });
    expect(normalizeVideoEmbedUrl("https://vimeo.com/74921042?autoplay=1")).toEqual({
      provider: "vimeo",
      embedUrl: "https://player.vimeo.com/video/74921042",
    });
  });

  it("flattens youtube shortcode to video widget stub", () => {
    const raw = "[youtube]https://www.youtube.com/watch?v=ABC123xyz[/youtube]";
    const { html } = flattenWordPressBuilders(raw);
    expect(html).toContain('data-wp-widget="video"');
    expect(html).toContain('data-video-provider="youtube"');
    expect(html).toContain('data-embed-url="https://www.youtube-nocookie.com/embed/ABC123xyz"');
    expect(html).not.toMatch(/\[youtube/);
  });

  it("flattens tatsu_video with YouTube URL to video widget stub", () => {
    const raw =
      '[tatsu_video video= "https://www.youtube.com/watch?v=ABC123xyz"][/tatsu_video]';
    const { html, detectedThemes } = flattenWordPressBuilders(raw);
    expect(detectedThemes).toContain("tatsu");
    expect(html).toContain('data-wp-widget="video"');
    expect(html).toContain("youtube-nocookie.com/embed/ABC123xyz");
    expect(html).not.toMatch(/\[tatsu_video/);
  });

  it("parses fractional column token names into width percentages", () => {
    expect(parseFractionalColumnWidth("one_third")).toBe("33.33%");
    expect(parseFractionalColumnWidth("one_half")).toBe("50%");
    expect(parseFractionalColumnWidth("three_fourths")).toBe("75%");
  });

  it("applies fractional layoutMap for legacy Blox section/row/column tokens", () => {
    const raw =
      '[section bg_image="https://example.com/hero.jpg"][row][one_third]<h6>Left</h6>[/one_third]' +
      '[two_third]<p>Right</p>[/two_third][/row][/section]';
    const html = applyStructuralLayoutMap(
      raw,
      fractionalLayoutMap({
        section: "section",
        row: "row",
        columns: ["one_third", "two_third", "one_half", "one_col"],
        bgParamName: "bg_image",
      }),
    );
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-bg-image="https://example.com/hero.jpg"');
    expect(html).toContain('data-layout="row"');
    expect(html).toContain('data-layout="column" data-col-width="33.33%"');
    expect(html).toContain('data-layout="column" data-col-width="66.67%"');
    expect(html).toContain("<h6>Left</h6>");
    expect(html).not.toMatch(/\[(section|row|one_third|two_third)\b/);
  });

  it("flattens legacy Blox section/row/column via oshine registry fractional profile", () => {
    const raw = '[section][row][one_col][text]<h1>Hello</h1>[/text][/one_col][/row][/section]';
    const { html, detectedThemes } = flattenWordPressBuilders(raw);
    expect(detectedThemes).toContain("oshine");
    expect(html).toContain('data-layout="section"');
    expect(html).toContain('data-layout="row"');
    expect(html).toContain('data-layout="column" data-col-width="100%"');
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).not.toMatch(/\[(section|row|one_col)\b/);
    expect(html).not.toMatch(/\[text\b/);
  });

  it("strips animate_icon scaffolding when that is the only builder marker", () => {
    const raw =
      '[animate_icons_style1 height= "200" key= "x"][animate_icon_style1 icon= "icon-email" key= "y"]' +
      "<p>hello@example.com</p>";
    const { html, detectedThemes } = flattenWordPressBuilders(raw);
    expect(detectedThemes).toContain("oshine");
    expect(html).toContain("<p>hello@example.com</p>");
    expect(html).not.toMatch(/\[animate_icon/);
  });
});

describe("findWordPressShortcodeMarkers", () => {
  it("flags unresolvable dynamic shortcodes", () => {
    const { html } = flattenWordPressBuilders(
      '[portfolio col="two"][/portfolio][recent_posts number="three"][/recent_posts][woocommerce_cart]',
    );
    const markers = findWordPressShortcodeMarkers(html);
    expect(markers.map((m) => m.shortcode)).toEqual(["woocommerce_cart"]);
    expect(markers.every((m) => m.unresolvable)).toBe(true);
    expect(html).toContain('data-wp-widget="portfolio"');
    expect(html).toContain('data-wp-widget="blog-listing"');
    expect(html).toContain('data-wp-blog-limit="3"');
  });
});
