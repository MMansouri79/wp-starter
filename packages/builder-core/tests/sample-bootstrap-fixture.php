<?php
/** Executable contract fixture. No live site, users, network or private packages. */
define( 'ABSPATH', __DIR__ . '/' );
class WP_Error {
    private $code; private $message;
    public function __construct( $code, $message ) { $this->code = $code; $this->message = $message; }
    public function get_error_code() { return $this->code; }
    public function get_error_message() { return $this->message; }
}
function is_wp_error( $value ) { return $value instanceof WP_Error; }
$GLOBALS['terms'] = array(); $GLOBALS['options'] = array(); $GLOBALS['termmeta'] = array();
function taxonomy_exists( $taxonomy ) { return in_array( $taxonomy, array( 'category', 'post_tag', 'product_cat', 'product_tag', 'product_shipping_class', 'pa_color' ), true ); }
function get_term_by( $field, $slug, $taxonomy ) { foreach ( $GLOBALS['terms'] as $term ) { if ( $term->taxonomy === $taxonomy && rawurldecode( $term->slug ) === rawurldecode( $slug ) ) return clone $term; } return false; }
function get_term( $id, $taxonomy ) { return isset( $GLOBALS['terms'][$id] ) ? clone $GLOBALS['terms'][$id] : null; }
function wp_insert_term( $name, $taxonomy, $args ) {
    $id = count( $GLOBALS['terms'] ) + 1;
    $slug = ! empty( $GLOBALS['force_slug_suffix'] ) ? $args['slug'] . '-2' : $args['slug'];
    $GLOBALS['terms'][$id] = (object) array( 'term_id' => $id, 'taxonomy' => $taxonomy, 'name' => $name, 'slug' => $slug, 'description' => $args['description'], 'parent' => $args['parent'] );
    return array( 'term_id' => $id, 'term_taxonomy_id' => $id );
}
function wp_kses_post( $value ) { return strip_tags( $value, '<p><strong><em>' ); }
function update_term_meta( $id, $key, $value ) { $GLOBALS['termmeta'][$id][$key] = $value; }
function get_option( $key, $default = false ) { return $GLOBALS['options'][$key] ?? $default; }
function update_option( $key, $value, $autoload = null ) { $GLOBALS['options'][$key] = $value; return true; }
function check( $condition, $message ) { if ( ! $condition ) { fwrite( STDERR, $message . "\n" ); exit( 1 ); } }
require __DIR__ . '/../../../wordpress/bootstrap/sample-content-installer.php';
$parent = array( 'id' => 'parent', 'taxonomy' => 'category', 'name' => 'Parent', 'slug' => 'parent', 'description' => '' );
$child = array( 'id' => 'child', 'taxonomy' => 'category', 'name' => 'Child', 'slug' => 'child', 'description' => '', 'parentId' => 'parent' );
$installer = new MMS_WP_Starter_Sample_Content( array( 'terms' => array( $child, $parent ) ), __DIR__ );
$ordered = $installer->ordered_terms();
check( array_column( $ordered, 'id' ) === array( 'parent', 'child' ), 'Parents must be sorted before children.' );
foreach ( $ordered as $term ) { check( ! is_wp_error( $installer->install_term( $term ) ), 'Valid term installation must succeed.' ); }
check( $GLOBALS['terms'][2]->parent === 1, 'Child must use destination parent id.' );
check( $installer->resolve_term_ids( array( 'child' ), 'category' ) === array( 2 ), 'Assignments must use integer ids.' );
check( $installer->install_term( $child ) === 2 && count( $GLOBALS['terms'] ) === 2, 'Retry must not duplicate terms.' );
$changed = $child; $changed['name'] = 'New name';
check( $installer->install_term( $changed ) === 2 && $GLOBALS['terms'][2]->name === 'Child', 'Reusing a term must preserve destination data.' );
check( ! empty( $GLOBALS['options']['mms_wp_starter_sample_warnings']['child'] ), 'Differing existing name must be reported.' );
$conflict = $child; unset( $conflict['parentId'] );
check( is_wp_error( $installer->install_term( $conflict ) ), 'Existing incompatible parent must fail.' );
$brand = array( 'id' => 'brand', 'taxonomy' => 'product_brand', 'name' => 'Brand', 'slug' => 'brand', 'description' => '' );
check( is_wp_error( $installer->install_term( $brand ) ), 'Missing core brand support must fail, not skip.' );
check( MMS_WP_Starter_Sample_Content::same_slug( rawurlencode( 'نمونه' ), 'نمونه' ), 'WordPress encoded Unicode slugs must compare correctly.' );
$GLOBALS['force_slug_suffix'] = true;
$other = $parent; $other['slug'] = 'other'; $other['id'] = 'other';
check( is_wp_error( $installer->install_term( $other ) ), 'Unexpected WordPress slug suffix must fail.' );
$cycle = $parent; $cycle['parentId'] = 'child';
$cyclic = new MMS_WP_Starter_Sample_Content( array( 'terms' => array( $cycle, $child ) ), __DIR__ );
check( is_wp_error( $cyclic->ordered_terms() ), 'Cycles must fail deterministically.' );
echo "PASS sample taxonomy ordering, exact slugs, hierarchy, conflicts and retry\n";

// Post API contracts: errors must not be swallowed and retries must recover drafts.
define( 'OBJECT', 'OBJECT' );
$GLOBALS['posts'] = array(); $GLOBALS['postmeta'] = array(); $GLOBALS['object_terms'] = array();
function get_post_stati() { return array( 'draft' => 'draft', 'publish' => 'publish', 'private' => 'private', 'future' => 'future', 'pending' => 'pending', 'inherit' => 'inherit', 'trash' => 'trash' ); }
function get_posts( $args ) { $ids = array(); foreach ( $GLOBALS['posts'] as $id => $post ) if ( $post->post_type === $args['post_type'] && ( $GLOBALS['postmeta'][$id][$args['meta_key']] ?? '' ) === $args['meta_value'] ) $ids[] = $id; return $ids; }
function get_page_by_path( $slug, $output, $type ) { foreach ( $GLOBALS['posts'] as $post ) if ( $post->post_name === $slug && $post->post_type === $type ) return clone $post; return null; }
function get_post( $id ) { return isset( $GLOBALS['posts'][$id] ) ? clone $GLOBALS['posts'][$id] : null; }
function sanitize_title( $value ) { return strtolower( str_replace( ' ', '-', $value ) ); }
function sanitize_text_field( $value ) { return strip_tags( $value ); }
function wp_slash( $value ) { return $value; }
function get_current_user_id() { return 7; }
function current_theme_supports( $feature, $value = null ) { return false; }
function wp_insert_post( $fields, $error = false ) {
    if ( ! empty( $GLOBALS['fail_insert'] ) ) return new WP_Error( 'insert_failed', 'Synthetic insert failure' );
    $id = $fields['ID'] ?? ( count( $GLOBALS['posts'] ) + 1 );
    $before = isset( $GLOBALS['posts'][$id] ) ? (array) $GLOBALS['posts'][$id] : array();
    $GLOBALS['posts'][$id] = (object) array_merge( $before, $fields, array( 'ID' => $id ) );
    foreach ( $fields['meta_input'] ?? array() as $key => $value ) $GLOBALS['postmeta'][$id][$key] = $value;
    return $id;
}
function wp_update_post( $fields, $error = false ) { return wp_insert_post( $fields, $error ); }
function wp_set_object_terms( $id, $terms, $taxonomy, $append = false ) { if ( ! empty( $GLOBALS['fail_assignment'] ) ) return new WP_Error( 'assignment_failed', 'Synthetic taxonomy failure' ); $GLOBALS['object_terms'][$id][$taxonomy] = $terms; return $terms; }
function set_post_thumbnail( $id, $image ) { $GLOBALS['postmeta'][$id]['thumbnail'] = $image; }
function delete_post_thumbnail( $id ) { unset( $GLOBALS['postmeta'][$id]['thumbnail'] ); }
function set_post_format( $id, $format ) { $GLOBALS['postmeta'][$id]['format'] = $format; }
function stick_post( $id ) { $GLOBALS['postmeta'][$id]['sticky'] = true; }
function unstick_post( $id ) { $GLOBALS['postmeta'][$id]['sticky'] = false; }
function get_date_from_gmt( $date ) { return $date; }
$post = array( 'id' => 'post-one', 'kind' => 'post', 'title' => 'Sample post', 'slug' => 'sample-post', 'content' => '<p>Text</p><script>bad()</script>', 'excerpt' => 'Excerpt', 'categoryIds' => array( 'child' ), 'tagIds' => array(), 'status' => 'publish', 'sticky' => true );
$id = $installer->install_post( $post );
check( $id === 1 && $GLOBALS['posts'][1]->post_status === 'draft', 'Content must be staged as draft.' );
check( $GLOBALS['posts'][1]->post_author === 7, 'Destination administrator owns the sample post.' );
check( $GLOBALS['object_terms'][1]['category'] === array( 2 ), 'Post terms must use resolved numeric ids.' );
check( strpos( $GLOBALS['posts'][1]->post_content, '<script>' ) === false, 'Content must pass through post HTML sanitization.' );
check( $installer->install_post( $post ) === 1 && count( $GLOBALS['posts'] ) === 1, 'Post retry must not duplicate rows.' );
check( $installer->publish_row( $post ) === 1 && $GLOBALS['posts'][1]->post_status === 'publish', 'Publication should apply only in final stage.' );
$private = $post; $private['status'] = 'private';
check( $installer->publish_row( $private ) === 1 && $GLOBALS['posts'][1]->post_status === 'private', 'Private final status must be preserved.' );
$other = $post; $other['id'] = 'unrelated';
check( is_wp_error( $installer->install_post( $other ) ), 'Unrelated matching slug must be rejected.' );
$GLOBALS['fail_assignment'] = true;
check( is_wp_error( $installer->install_post( $post ) ), 'Taxonomy assignment failure must propagate.' );
unset( $GLOBALS['fail_assignment'] );
check( $installer->install_post( $post ) === 1, 'Retry after partial insertion must recover same owned record.' );
$GLOBALS['fail_insert'] = true;
check( is_wp_error( $installer->install_post( $post ) ), 'Insertion error must propagate.' );
unset( $GLOBALS['fail_insert'] );
$format = $post; $format['format'] = 'video';
check( is_wp_error( $installer->install_post( $format ) ), 'Unsupported theme post format must fail explicitly.' );
echo "PASS sample post fields, staged publication, error propagation, ownership and retry\n";
function wp_json_encode( $value ) { return json_encode( $value ); }
function wp_generate_uuid4() { return uniqid( 'fixture-', true ); }
function add_option( $key, $value, $deprecated = '', $autoload = false ) { if ( isset( $GLOBALS['options'][$key] ) ) return false; $GLOBALS['options'][$key] = $value; return true; }
function delete_option( $key ) { unset( $GLOBALS['options'][$key] ); }
function wp_get_object_terms( $id, $taxonomy, $args ) { return $GLOBALS['object_terms'][$id][$taxonomy] ?? array(); }
$payload = array( 'schemaVersion' => 1, 'content' => array( $post ), 'terms' => array( $parent, $child ), 'attributes' => array(), 'assets' => array() );
$runner = new MMS_WP_Starter_Sample_Content( $payload, __DIR__ );
unset( $GLOBALS['force_slug_suffix'] );
$done = false; $steps = 0;
while ( ! $done && ++$steps < 30 ) {
    $done = $runner->step();
    check( ! is_wp_error( $done ), 'Resumable installer step failed: ' . ( is_wp_error( $done ) ? $done->get_error_message() : '' ) );
    check( ! isset( $GLOBALS['options'][MMS_WP_Starter_Sample_Content::LOCK_OPTION] ), 'Step lock must be released.' );
}
check( true === $done && $steps > 7, 'All staged installation phases must execute before done.' );
check( count( $GLOBALS['posts'] ) === 1 && $runner->step() === true, 'Completed retries must not duplicate content.' );
echo "PASS complete staged sample installer with saved checkpoints\n";

// WooCommerce CRUD contract double deliberately rejects unknown setter names.
$GLOBALS['products'] = array();
class WC_Tax { public static function get_tax_class_slugs() { return array( 'reduced-rate' ); } }
class WC_Product_Download { public $data = array(); public function set_id( $v ) { $this->data['id'] = $v; } public function set_name( $v ) { $this->data['name'] = $v; } public function set_file( $v ) { $this->data['file'] = $v; } }
class WC_Product_Attribute {
    public $data = array();
    public function __call( $method, $args ) { if ( ! in_array( $method, array( 'set_id', 'set_name', 'set_options', 'set_position', 'set_visible', 'set_variation' ), true ) ) throw new Exception( 'Unknown attribute method ' . $method ); $this->data[substr( $method, 4 )] = $args[0]; }
}
class WC_Product_Simple {
    public $data = array(); private $meta = array(); protected $id;
    public function __construct( $id = 0 ) { $this->id = $id; if ( $id && isset( $GLOBALS['products'][$id] ) ) { $this->data = $GLOBALS['products'][$id]->data; } }
    public function get_id() { return $this->id; }
    public function get_parent_id() { return $this->data['parent_id'] ?? 0; }
    public function set_global_unique_id( $value ) { $this->data['global_unique_id'] = $value; }
    public function __call( $method, $args ) {
        $valid = array( 'name','slug','status','description','short_description','catalog_visibility','featured','menu_order','reviews_allowed','purchase_note','tax_status','sku','sold_individually','manage_stock','stock_quantity','stock_status','backorders','low_stock_amount','weight','length','width','height','shipping_class_id','tax_class','regular_price','sale_price','date_on_sale_from','date_on_sale_to','virtual','downloadable','downloads','download_limit','download_expiry','category_ids','tag_ids','image_id','gallery_image_ids','attributes','default_attributes','parent_id','upsell_ids','cross_sell_ids' );
        if ( $this instanceof WC_Product_Grouped ) $valid[] = 'children';
        if ( $this instanceof WC_Product_External ) { $valid[] = 'product_url'; $valid[] = 'button_text'; }
        if ( 0 !== strpos( $method, 'set_' ) || ! in_array( substr( $method, 4 ), $valid, true ) ) throw new Exception( 'Unknown WC method ' . $method );
        $this->data[substr( $method, 4 )] = $args[0];
    }
    public function update_meta_data( $key, $value ) { $this->meta[$key] = $value; }
    public function save() {
        if ( ! $this->id ) $this->id = count( $GLOBALS['posts'] ) + 1;
        $GLOBALS['products'][$this->id] = clone $this;
        $GLOBALS['posts'][$this->id] = (object) array( 'ID' => $this->id, 'post_type' => $this instanceof WC_Product_Variation ? 'product_variation' : 'product', 'post_name' => $this->data['slug'] ?? '', 'post_title' => $this->data['name'] ?? '', 'post_status' => $this->data['status'] );
        foreach ( $this->meta as $key => $value ) $GLOBALS['postmeta'][$this->id][$key] = $value;
        $GLOBALS['object_terms'][$this->id]['product_cat'] = $this->data['category_ids'] ?? array();
        $GLOBALS['object_terms'][$this->id]['product_tag'] = $this->data['tag_ids'] ?? array();
        return $this->id;
    }
}
class WC_Product_Variable extends WC_Product_Simple { public static function sync( $id ) { $GLOBALS['synced'][$id] = true; } }
class WC_Product_Grouped extends WC_Product_Simple { public static function sync( $id ) { $GLOBALS['synced'][$id] = true; } }
class WC_Product_External extends WC_Product_Simple {}
class WC_Product_Variation extends WC_Product_Simple {}
function wc_get_product( $id ) { return isset( $GLOBALS['products'][$id] ) ? clone $GLOBALS['products'][$id] : false; }
function wc_get_product_id_by_sku( $sku ) { foreach ( $GLOBALS['products'] as $id => $p ) if ( ( $p->data['sku'] ?? '' ) === $sku ) return $id; return 0; }
function wc_delete_product_transients( $id ) {}
function wc_attribute_taxonomy_id_by_name( $name ) { return 'pa_color' === $name ? 55 : 0; }
function esc_url_raw( $url, $protocols = null ) { return $url; }
$base = array( 'id'=>'simple-product', 'kind'=>'product', 'title'=>'Simple', 'slug'=>'simple', 'productType'=>'simple', 'status'=>'draft', 'content'=>'Description', 'shortDescription'=>'Short', 'catalogVisibility'=>'visible', 'featured'=>false, 'menuOrder'=>2, 'reviewsAllowed'=>true, 'purchaseNote'=>'Note', 'taxStatus'=>'taxable', 'taxClass'=>'', 'categoryIds'=>array(), 'tagIds'=>array(), 'brandIds'=>array(), 'galleryIds'=>array(), 'attributes'=>array(), 'upsellIds'=>array(), 'crossSellIds'=>array(), 'pricing'=>array('regularPrice'=>'20.00','salePrice'=>'15.00'), 'inventory'=>array('sku'=>'SKU-1','globalUniqueId'=>'','manageStock'=>true,'quantity'=>5,'stockStatus'=>'instock','backorders'=>'no','lowStockThreshold'=>2,'soldIndividually'=>false), 'shipping'=>array('weight'=>'2','length'=>'10','width'=>'5','height'=>'3'), 'virtual'=>false,'downloadable'=>false,'downloads'=>array(),'downloadLimit'=>null,'downloadExpiry'=>null );
$woo = new MMS_WP_Starter_Sample_Content( array('terms'=>array(),'attributes'=>array(),'assets'=>array()), __DIR__ );
$simple_id = $woo->install_product( $base );
check( is_int( $simple_id ) && $GLOBALS['products'][$simple_id]->data['regular_price'] === '20.00', 'Simple product must use WooCommerce CRUD with string prices.' );
check( $GLOBALS['products'][$simple_id]->data['stock_quantity'] === 5 && $GLOBALS['products'][$simple_id]->data['status'] === 'draft', 'Product stock must persist while parent stays draft.' );
check( $woo->install_product( $base ) === $simple_id, 'WooCommerce retries must load owned numeric destination id.' );
$conflict = $base; $conflict['id']='different-product'; $conflict['slug']='different';
check( is_wp_error( $woo->install_product( $conflict ) ), 'Destination SKU conflict must stop installation.' );
$external = $base; $external['id']='external-product'; $external['slug']='external'; $external['productType']='external'; $external['externalUrl']='https://example.test/item'; $external['buttonText']='Visit'; $external['inventory']['sku']='EXTERNAL';
$external_id = $woo->install_product( $external );
check( $GLOBALS['products'][$external_id] instanceof WC_Product_External && $GLOBALS['products'][$external_id]->data['button_text'] === 'Visit', 'External product fields must use external CRUD class.' );
$grouped = $base; $grouped['id']='grouped-product'; $grouped['slug']='grouped'; $grouped['productType']='grouped'; $grouped['inventory']['sku']='GROUP'; $grouped['childrenIds']=array('simple-product');
$group_id = $woo->install_product( $grouped ); check( $woo->link_product( $grouped ) === true && $GLOBALS['products'][$group_id]->data['children'] === array($simple_id), 'Grouped references must map logical ids to destination ids.' );
$variable = $base; $variable['id']='variable-product'; $variable['slug']='variable'; $variable['productType']='variable'; $variable['inventory']['sku']='VARIABLE'; $variable['attributes']=array(array('id'=>'size','name'=>'Size','options'=>array('Small','Large'),'visible'=>true,'variation'=>true)); $variable['defaultAttributes']=array('size'=>'Small');
$variant = array('id'=>'variation-one','enabled'=>true,'description'=>'Variant','attributes'=>array('size'=>'Large'),'inventory'=>$base['inventory'],'shipping'=>$base['shipping'],'pricing'=>$base['pricing'],'taxClass'=>'parent','virtual'=>false,'downloadable'=>false,'downloads'=>array(),'downloadLimit'=>null,'downloadExpiry'=>null); $variant['inventory']['sku']='VARIANT-1';
$variable['variations']=array($variant);
$variable_id = $woo->install_product( $variable );
check( is_int($variable_id), 'Variable product CRUD must succeed.' );
$variant_id = $woo->owned_post( 'variation-one', 'product_variation' );
check( $GLOBALS['products'][$variant_id]->data['parent_id'] === $variable_id && $GLOBALS['products'][$variant_id]->data['attributes'] === array('size'=>'Large'), 'Local variation attributes must preserve selected value and correct parent.' );
check( $woo->link_product($variable) === true && !empty($GLOBALS['synced'][$variable_id]), 'Variable parent must synchronize lookup data after children.' );
check( $woo->install_product($variable) === $variable_id && $woo->owned_post('variation-one','product_variation') === $variant_id, 'Variable retries must not duplicate parent or child.' );
echo "PASS all four WooCommerce CRUD types, variation remapping, identifiers and relationships\n";
