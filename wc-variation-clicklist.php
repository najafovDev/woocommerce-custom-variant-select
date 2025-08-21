<?php
/**
 * Plugin Name: WC Variation Clicklist
 * Description: Variation list with +/- only quantity, live row totals & grand total, and Direct Checkout.
 * Version: 1.6.93
 * Author: Sadig Najafov
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'WCVCL_VER',  '1.6.93' );
define( 'WCVCL_FILE', __FILE__ );
define( 'WCVCL_DIR',  plugin_dir_path( __FILE__ ) );
define( 'WCVCL_URL',  plugin_dir_url( __FILE__ ) );

if ( ! class_exists( 'WC_Variation_Clicklist' ) ) {
class WC_Variation_Clicklist {
    const VER = '1.6.93';
    private $rendered = false;

    public function __construct() {
        add_action( 'wp_enqueue_scripts', [ $this, 'assets' ], 100 );
        add_filter( 'body_class', function( $c ){ $c[] = 'wcvcl-active'; return $c; } );
        add_filter( 'woocommerce_dropdown_variation_attribute_options_html', [ $this, 'replace_dropdown_with_list' ], 10, 2 );
        add_action( 'woocommerce_before_add_to_cart_form', [ $this, 'render_multi_variation_block' ], 0 );
        add_action( 'wp_loaded', [ $this, 'handle_multi_add_to_cart' ] );
        add_action( 'wp', [ $this, 'suppress_native_add_to_cart' ] );
        add_action( 'wp_footer', [ $this, 'late_inline_overrides' ], 9999 );
        add_filter( 'the_content', [ $this, 'place_before_theme_container' ], 1 );
        add_filter( 'render_block', [ $this, 'intercept_add_to_cart_block' ], 9, 2 );
        add_action( 'template_redirect', [ $this, 'start_ob_for_inplace' ], 0 );
    }

    public function assets() {
        if ( ! function_exists( 'is_product' ) || ! is_product() ) return;
        $css = WCVCL_DIR . 'assets/wcvcl.css';
        $js  = WCVCL_DIR . 'assets/wcvcl.js';
        $css_ver = file_exists( $css ) ? filemtime( $css ) : self::VER;
        $js_ver  = file_exists( $js )  ? filemtime( $js )  : self::VER;

        wp_enqueue_style( 'wcvcl-fonts','https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700;800&display=swap',[],null );
        wp_enqueue_style( 'wcvcl', WCVCL_URL . 'assets/wcvcl.css', [ 'wcvcl-fonts' ], $css_ver );

        wp_enqueue_script( 'jquery-blockui' );
        $deps = [ 'jquery', 'jquery-blockui', 'wc-add-to-cart-variation' ];
        wp_enqueue_script( 'wcvcl', WCVCL_URL . 'assets/wcvcl.js', $deps, $js_ver, true );

        $currency = function_exists( 'get_woocommerce_currency_symbol' ) ? get_woocommerce_currency_symbol() : '';

        wp_localize_script( 'wcvcl', 'wcvclSettings', [
            'currency_symbol'   => $currency,
            'currency_pos'      => function_exists('get_option') ? get_option('woocommerce_currency_pos') : 'left',
            'decimal'           => function_exists('wc_get_price_decimal_separator') ? wc_get_price_decimal_separator() : '.',
            'thousand'          => function_exists('wc_get_price_thousand_separator') ? wc_get_price_thousand_separator() : ',',
            'decimals'          => function_exists('wc_get_price_decimals') ? wc_get_price_decimals() : 2,
            'i18n_total'        => __( 'TOTAL:', 'wcvcl' ),
            'i18n_direct'       => __( 'ADD TO BASKET', 'wcvcl' ),
        ] );
    }

    public function late_inline_overrides() {
        if ( ! function_exists( 'is_product' ) || ! is_product() ) return;
        $prod = wc_get_product( get_the_ID() );
        if ( ! $prod instanceof WC_Product_Variable ) return;
        $vars = $prod->get_available_variations();
        if ( empty( $vars ) ) return;

        echo '<style id="wcvcl-inline-fixes">
body.wcvcl-active form.cart .single_add_to_cart_button { display:none !important; }
body.wcvcl-active .variations_form .quantity { display:none !important; }
#wcvcl-express > #wc-stripe-express-checkout-element { display:block !important; width:100% !important; min-height:56px !important; padding:8px 0 !important; opacity:1 !important; visibility:visible !important; }
#wcvcl-express #wc-stripe-express-checkout-element iframe { display:block !important; min-height:52px !important; opacity:1 !important; visibility:visible !important; pointer-events:auto !important; }
</style>';
    }

    public function replace_dropdown_with_list( $html, $args ) { return $html; }

    public function render_multi_variation_block() {
        echo '<div id="wcvcl-mount" style="display:block">';
        if ( $this->rendered ) return;
        global $product;
        if ( ! $product || ! $product->is_purchasable() ) return;
        $vars = method_exists( $product, 'get_available_variations' ) ? $product->get_available_variations() : [];
        if ( empty( $vars ) ) return;

        echo '<form method="post" class="wcvcl-multi-form" action="">';
        wp_nonce_field( 'wcvcl_multi_add', 'wcvcl_nonce' );
        echo '<input type="hidden" name="wcvcl_multi_add" value="1">';
        echo '<input type="hidden" name="wcvcl_product_id" value="' . esc_attr( $product->get_id() ) . '">';

        echo '<div class="wcvcl-card">';
        foreach ( $vars as $row ) {
            if ( empty( $row['variation_id'] ) ) continue;
            $vid = (int) $row['variation_id'];
            $var_obj = wc_get_product( $vid );
            if ( ! $var_obj ) continue;
            $purch     = $var_obj->is_purchasable() && $var_obj->is_in_stock();
            $stock_qty = $var_obj->managing_stock() ? (int) $var_obj->get_stock_quantity() : '';
            $max = '';
            if ( ! $var_obj->backorders_allowed() && $stock_qty !== '' ) $max = $stock_qty;

            $attrs_for_title = [];
            foreach ( $row['attributes'] as $k => $v ) {
                $tax = str_replace( 'attribute_', '', $k );
                if ( taxonomy_exists( $tax ) ) {
                    $term = get_term_by( 'slug', $v, $tax );
                    $val  = $term ? $term->name : $v;
                } else {
                    $val  = $v;
                }
                $attrs_for_title[] = $val;
            }
            $title      = implode( ' – ', $attrs_for_title );
            $unit_price = (float) $var_obj->get_price();
            $desc       = $var_obj->get_description();
            $row_attrs_json = esc_attr( wp_json_encode( $row['attributes'] ) );

            echo '<div class="wcvcl-row' . ( ! $purch ? ' is-soldout' : '' ) . '">';
            echo   '<div class="wcvcl-row-main">';
            echo     '<div class="wcvcl-title">' . esc_html( $title ) . '</div>';
            echo     '<button type="button" class="wcvcl-info" aria-label="More info" aria-expanded="false" aria-controls="wcvcl-desc-' . esc_attr( $vid ) . '" data-target="#wcvcl-desc-' . esc_attr( $vid ) . '">i</button>';
            echo     '<div class="wcvcl-price"><span class="wcvcl-price-amount" data-unit="' . esc_attr( $unit_price ) . '">' . wc_price( $unit_price ) . '</span></div>';
            echo   '</div>';

            echo   '<div class="wcvcl-row-ctrl">';
            if ( ! $purch ) {
                echo '<span class="wcvcl-soldout">' . esc_html__( 'SOLD OUT', 'wcvcl' ) . '</span>';
            } else {
                $hid_id = 'wcvcl_qty_' . $vid;
                echo '<div class="wcvcl-stepper" data-vid="' . esc_attr( $vid ) . '" data-max="' . esc_attr( $max ) . '" data-unit-price="' . esc_attr( $unit_price ) . '" data-attrs="' . $row_attrs_json . '">';
                echo   '<button type="button" class="wcvcl-circ-btn wcvcl-minus" aria-label="Decrease" aria-controls="' . esc_attr( $hid_id ) . '">−</button>';
                echo   '<span class="wcvcl-qty-badge" aria-live="polite" aria-atomic="true">0</span>';
                echo   '<button type="button" class="wcvcl-circ-btn wcvcl-plus" aria-label="Increase" aria-controls="' . esc_attr( $hid_id ) . '">+</button>';
                echo   '<input type="hidden" id="' . esc_attr( $hid_id ) . '" class="wcvcl-qty-input" name="wcvcl_quantity[' . esc_attr( $vid ) . ']" value="0" data-max="' . esc_attr( $max ) . '">';
                echo '</div>';
            }
            echo   '</div>';
            echo '</div>';

            if ( $desc ) {
                $desc_html = wpautop( $desc );
                $desc_html = preg_replace_callback( '/<p\b([^>]*)>/', function ( $m ) {
                    $attrs = $m[1];
                    if ( stripos( $attrs, 'style=' ) !== false ) {
                        $attrs = preg_replace( '/style=("|\')/i', 'style=\\1color:#000 !important; font-size:14px !important; font-weight:300 !important; line-height:1.55 !important; ', $attrs, 1 );
                        return '<p' . $attrs . '>';
                    }
                    return '<p' . $attrs . ' style="color:#000 !important; font-size:14px !important; font-weight:300 !important; line-height:1.55 !important;">';
                }, $desc_html );
                echo '<div id="wcvcl-desc-' . esc_attr( $vid ) . '" class="wcvcl-desc-row" hidden>' . wp_kses_post( $desc_html ) . '</div>';
            }
        }

        echo '</div>';
        echo '<div id="wcvcl-express" class="wcvcl-express"></div>';
        echo '<div id="wcvcl-bottombar-root" class="wcvcl-bottombar">';
        echo   '<div class="wcvcl-bottom-total"><span class="wcvcl-bottom-total-label">' . esc_html__( 'TOTAL:', 'wcvcl' ) . '</span> <span class="wcvcl-bottom-total-price">' . wc_price( 0 ) . '</span></div>';
        echo   '<button type="button" name="wcvcl_direct_btn" value="1" class="wcvcl-direct-btn" data-loading="ADDING…" disabled>' . esc_html__( 'ADD TO BASKET', 'wcvcl' ) . '</button>';
        echo '</div>';
        echo '</form>';

        $this->rendered = true;
    }

    public function handle_multi_add_to_cart() {
        if ( empty( $_POST['wcvcl_multi_add'] ) ) return;
        if ( ! wp_verify_nonce( $_POST['wcvcl_nonce'] ?? '', 'wcvcl_multi_add' ) ) return;

        $parent_id = intval( $_POST['wcvcl_product_id'] ?? 0 );
        if ( $parent_id <= 0 ) return;

        $qtys = $_POST['wcvcl_quantity'] ?? [];
        if ( empty( $qtys ) || ! is_array( $qtys ) ) return;

        $added = 0;
        foreach ( $qtys as $vid => $qty ) {
            $vid = intval( $vid );
            $qty = max( 0, intval( $qty ) );
            if ( $qty < 1 ) continue;

            $var = wc_get_product( $vid );
            if ( ! $var || $var->get_parent_id() !== $parent_id ) continue;
            if ( ! $var->is_purchasable() || ! $var->is_in_stock() ) continue;

            $attrs = $var->get_variation_attributes();
            $ok = WC()->cart->add_to_cart( $parent_id, $qty, $vid, $attrs );
            if ( $ok ) $added++;
        }

        if ( $added <= 0 ) {
            wc_add_notice( esc_html__( 'Nothing selected.', 'wcvcl' ), 'error' );
            wp_safe_redirect( wc_get_cart_url() );
            exit;
        }

        if ( ! empty( $_POST['wcvcl_direct'] ) ) {
            wp_safe_redirect( wc_get_checkout_url() );
        } else {
            wc_add_notice( sprintf( esc_html__( '%d variation(s) added to cart.', 'wcvcl' ), $added ), 'success' );
            wp_safe_redirect( wc_get_cart_url() );
        }
        exit;
    }

    public function suppress_native_add_to_cart() {
        if ( ! function_exists( 'is_product' ) || ! is_product() ) return;
        $product = wc_get_product( get_the_ID() );
        if ( ! $product instanceof WC_Product_Variable ) return;
        $vars = method_exists( $product, 'get_available_variations' ) ? $product->get_available_variations() : [];
        if ( empty( $vars ) ) return;
        add_filter( 'body_class', function( $classes ){ $classes[] = 'wcvcl-active'; return $classes; } );
    }

    private function sanitize_native_form_html( $html ) {
        if ( preg_match( '/<form[^>]*\bclass="([^"]*)"[^>]*>/i', $html, $m ) ) {
            $newClass = trim( $m[1] . ' wcvcl-native' );
            $html = preg_replace( '/<form([^>]*)\bclass="[^"]*"([^>]*)>/i', '<form$1 class="' . esc_attr( $newClass ) . '" data-wcvcl="native"$2>', $html, 1 );
        } else {
            $html = preg_replace( '/<form/i', '<form class="wcvcl-native" data-wcvcl="native"', $html, 1 );
        }
        return $html;
    }

    public function intercept_add_to_cart_block( $content, $block ) {
        if ( empty( $block['blockName'] ) ) return $content;
        $targets = [
            'woocommerce/add-to-cart-with-options',
            'woocommerce/add-to-cart-form',
            'woocommerce/product-add-to-cart',
            'woocommerce/woocommerce-add-to-cart-form',
        ];
        if ( ! in_array( $block['blockName'], $targets, true ) ) return $content;
        if ( ! function_exists( 'is_product' ) || ! is_product() ) return $content;

        global $product;
        if ( ! $product instanceof WC_Product_Variable ) return $content;

        if ( $this->rendered ) {
            return $this->sanitize_native_form_html( $content );
        }
        ob_start();
        $this->render_multi_variation_block();
        $our = ob_get_clean();
        return $our . $this->sanitize_native_form_html( $content );
    }

    public function place_before_theme_container( $content ) {
        if ( ! function_exists( 'is_product' ) || ! is_product() ) return $content;
        global $product;
        if ( ! $product instanceof WC_Product_Variable ) return $content;
        $vars = method_exists( $product, 'get_available_variations' ) ? $product->get_available_variations() : [];
        if ( empty( $vars ) ) return $content;

        $pattern_form = '/<form[^>]*class="[^"]*\bcart\b[^"]*"[^>]*>[\s\S]*?<\/form>/i';

        if ( ! $this->rendered ) {
            ob_start();
            $this->render_multi_variation_block();
            $our = ob_get_clean();
            if ( $our ) {
                if ( preg_match( $pattern_form, $content ) ) {
                    $content = preg_replace_callback( $pattern_form, function( $m ) use ( $our ) {
                        return $our . $this->sanitize_native_form_html( $m[0] );
                    }, $content, 1 );
                } else {
                    $content = $our . $content;
                }
            }
        }

        $content = preg_replace_callback( $pattern_form, function( $m ) {
            return $this->sanitize_native_form_html( $m[0] );
        }, $content );

        return $content;
    }

    public function start_ob_for_inplace() {
        if ( ! function_exists( 'is_product' ) || ! is_product() ) return;
        add_filter( 'body_class', function( $c ){ $c[] = 'wcvcl-active'; return $c; } );
        ob_start( [ $this, 'buffer_replace_native' ] );
    }

    public function buffer_replace_native( $html ) {
        if ( $this->rendered ) return $html;
        if ( ! function_exists( 'is_product' ) || ! is_product() ) return $html;

        global $product;
        $vars = method_exists( $product, 'get_available_variations' ) ? $product->get_available_variations() : [];
        if ( empty( $vars ) ) return $html;

        ob_start();
        $this->render_multi_variation_block();
        $our = ob_get_clean();
        if ( empty( $our ) ) return $html;

        $pattern_block = '/<!--\s*wp:woocommerce\/[^\n]*add-to-cart[^\n]*-->[\s\S]*?<!--\s*\/wp:woocommerce\/[^\n]*add-to-cart[^\n]*-->/i';
        $replaced = preg_replace_callback( $pattern_block, function( $m ) use ( $our ) {
            $this->rendered = true;
            return $our . "\n" . $this->sanitize_native_form_html( $m[0] );
        }, $html, 1 );
        if ( $replaced !== null && $replaced !== $html ) return $replaced;

        $pattern_form = '/<form[^>]*class="[^"]*\bcart\b[^"]*"[^>]*>[\s\S]*?<\/form>/i';
        $replaced2 = preg_replace_callback( $pattern_form, function( $m ) use ( $our ) {
            $this->rendered = true;
            return $our . "\n" . $this->sanitize_native_form_html( $m[0] );
        }, $html, 1 );
        if ( $replaced2 !== null && $replaced2 !== $html ) return $replaced2;

        $needle = '<div class="row align-items-start custom-product-layout my-5 pb-5">';
        if ( strpos( $html, $needle ) !== false ) {
            $this->rendered = true;
            return str_replace( $needle, $our . $needle, $html );
        }

        return $html;
    }
}
new WC_Variation_Clicklist();
}
