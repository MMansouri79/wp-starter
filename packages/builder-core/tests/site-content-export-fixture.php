<?php
define( 'ABSPATH', __DIR__ . '/' );
$root = $argv[1];
function wp_upload_dir() { global $root; return array( 'basedir' => $root . '/uploads', 'baseurl' => 'https://source.test/uploads' ); }
function wp_normalize_path( $p ) { return str_replace( '\\', '/', $p ); }
function trailingslashit( $p ) { return rtrim( $p, '/\\' ) . '/'; }
function wp_mkdir_p( $p ) { return is_dir( $p ) || mkdir( $p, 0700, true ); }
function wp_json_encode( $v, $flags = 0 ) { return json_encode( $v, $flags ); }
function is_wp_error( $v ) { return false; }
function get_post( $id ) {
    if ( 9 === (int) $id ) return (object) array( 'ID' => 9, 'post_type' => 'attachment', 'post_excerpt' => 'Caption', 'post_content' => 'Image description' );
    if ( 10 === (int) $id ) return (object) array( 'ID' => 10, 'post_type' => 'attachment', 'post_excerpt' => '', 'post_content' => '' );
    return (object) array( 'ID' => $id, 'post_type' => 1 === (int) $id ? 'post' : 'product', 'post_status' => 'publish', 'post_title' => 1 === (int) $id ? 'An article' : 'Variable shirt', 'post_name' => 1 === (int) $id ? 'article' : 'shirt', 'post_content' => '<p>Details <img class="wp-image-9" src="https://source.test/uploads/image.png"></p>', 'post_excerpt' => 'Excerpt', 'post_password' => '', 'post_date_gmt' => '2020-05-04 10:00:00', 'post_modified_gmt' => '2021-01-02 10:00:00', 'comment_status' => 'open', 'ping_status' => 'closed' );
}
function get_posts( $args ) { if ( ( $args['paged'] ?? 1 ) > 1 ) return array(); return array( get_post( 'post' === $args['post_type'] ? 1 : ( 'product' === $args['post_type'] ? 2 : 5 ) ) ); }
function get_post_thumbnail_id( $id ) { return 9; }
function get_attached_file( $id ) { global $root; return $root . '/uploads/' . ( 10 === (int) $id ? 'manual.pdf' : 'image.png' ); }
function get_post_meta( $id, $key, $single ) { return 'Image alt'; }
function attachment_url_to_postid( $url ) { return strpos( $url, 'image.png' ) !== false ? 9 : 0; }
function is_sticky( $id ) { return true; }
function get_post_format( $id ) { return false; }
function taxonomy_exists( $taxonomy ) { return in_array( $taxonomy, array( 'category', 'product_cat', 'pa_color' ), true ); }
function wp_get_object_terms( $id, $taxonomy ) { return in_array( $taxonomy, array( 'category', 'product_cat' ), true ) ? array( get_term( 'category' === $taxonomy ? 6 : 8, $taxonomy ) ) : array(); }
function get_term( $id, $taxonomy ) { return (object) array( 'term_id' => $id, 'taxonomy' => $taxonomy, 'name' => 3 === (int) $id ? 'Red' : ( 4 === (int) $id ? 'Blue' : 'Category' ), 'slug' => 3 === (int) $id ? 'red' : ( 4 === (int) $id ? 'blue' : 'category-' . $taxonomy ), 'description' => 'Term details', 'parent' => 0 ); }
function get_term_by( $field, $slug, $taxonomy ) { return get_term( 'red' === $slug ? 3 : 4, $taxonomy ); }
function get_term_meta( $id, $key, $single ) { return 0; }
class Fake_Attribute {
    private $global;
    function __construct( $global ) { $this->global = $global; }
    function get_id() { return 7; }
    function get_name() { return $this->global ? 'pa_color' : 'Size'; }
    function get_visible() { return true; }
    function get_variation() { return true; }
    function is_taxonomy() { return $this->global; }
    function get_options() { return $this->global ? array( 3, 4 ) : array( 'Small', 'Large' ); }
}
function wc_get_attribute( $id ) { return (object) array( 'name' => 'Color', 'slug' => 'pa_color', 'type' => 'select', 'order_by' => 'menu_order', 'has_archives' => true ); }
class Fake_Product {
    private $id;
    function __construct( $id ) { $this->id = $id; }
    function __call( $method, $args ) {
        $values = array( 'id' => $this->id, 'type' => 'variable', 'short_description' => '<p>Short description</p>', 'gallery_image_ids' => array( 9 ), 'catalog_visibility' => 'visible', 'featured' => true, 'sku' => 'SHIRT-' . $this->id, 'manage_stock' => true, 'stock_quantity' => 7, 'stock_status' => 'instock', 'backorders' => 'no', 'low_stock_amount' => 2, 'sold_individually' => false, 'shipping_class_id' => 0, 'weight' => '1', 'length' => '2', 'width' => '3', 'height' => '4', 'tax_status' => 'taxable', 'tax_class' => '', 'upsell_ids' => array(), 'cross_sell_ids' => array(), 'attributes' => 2 === $this->id ? array( 'pa_color' => new Fake_Attribute( true ), 'size' => new Fake_Attribute( false ) ) : array( 'pa_color' => 'red', 'size' => 'Large' ), 'purchase_note' => 'Thanks', 'menu_order' => 3, 'reviews_allowed' => true, 'default_attributes' => array( 'pa_color' => 'red', 'size' => 'Large' ), 'status' => 'publish', 'description' => 'Variation details', 'regular_price' => '20', 'sale_price' => '15', 'date_on_sale_from' => null, 'date_on_sale_to' => null, 'image_id' => 9, 'virtual' => false, 'downloadable' => false, 'downloads' => array(), 'download_limit' => -1, 'download_expiry' => -1 );
        $key = substr( $method, 4 ); if ( ! array_key_exists( $key, $values ) ) throw new RuntimeException( $method ); return $values[$key];
    }
}
function wc_get_product( $id ) { return new Fake_Product( (int) $id ); }
function acf_get_field_groups( $filter ) { return array( array( 'key' => 'group_details', 'title' => 'Details', 'location' => array( array( array( 'param' => 'post_type', 'operator' => '==', 'value' => 'post' ) ), array( array( 'param' => 'post_type', 'operator' => '==', 'value' => 'product' ) ) ) ) ); }
function acf_get_fields( $group ) { return array( array( 'key' => 'field_headline', 'name' => 'headline', 'label' => 'Headline', 'type' => 'text', 'ID' => 888, 'parent' => 777 ), array( 'key' => 'field_image', 'name' => 'image', 'label' => 'Image', 'type' => 'image' ), array( 'key' => 'field_related', 'name' => 'related', 'label' => 'Related', 'type' => 'relationship' ), array( 'key' => 'field_file', 'name' => 'manual', 'label' => 'Manual', 'type' => 'file' ), array( 'key' => 'field_rows', 'name' => 'rows', 'label' => 'Rows', 'type' => 'repeater', 'sub_fields' => array( array( 'key' => 'field_caption', 'name' => 'caption', 'label' => 'Caption', 'type' => 'text' ) ) ) ); }
function acf_get_value( $id, $field ) { $values = array( 'field_headline' => 'ACF headline', 'field_image' => 9, 'field_related' => array( $id ), 'field_file' => 10, 'field_rows' => array( array( 'field_caption' => 'Nested value' ) ) ); return $values[$field['key']]; }
require __DIR__ . '/../../../wordpress/exporter/includes/class-content-exporter.php';
wp_mkdir_p( $root . '/export' );
( new MMS\WPStarter\Exporter\Content_Exporter( $root . '/export' ) )->export( array( 'export_posts' => true, 'export_products' => true ) );
echo "Exported synthetic site content\n";
