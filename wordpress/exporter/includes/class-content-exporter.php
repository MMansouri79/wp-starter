<?php
namespace MMS\WPStarter\Exporter;

if ( ! defined( 'ABSPATH' ) ) { exit; }

/** Explicit editorial/catalog adapter. Never exports arbitrary meta or customer data. */
final class Content_Exporter {
    private $root;
    private $terms = array();
    private $attributes = array();
    private $assets = array();
    private $bytes = 0;

    public function __construct( $root ) { $this->root = $root; }

    public function export( array $selection ) {
        $content = array();
        foreach ( array( 'post' => 'export_posts', 'product' => 'export_products' ) as $type => $flag ) {
            if ( empty( $selection[$flag] ) ) { continue; }
            if ( 'product' === $type && ! function_exists( 'wc_get_product' ) ) { throw new \RuntimeException( 'Activate WooCommerce before exporting products.' ); }
            // Explicit statuses include private, pending and scheduled records, but not trash/revisions.
            for ( $page = 1; ; $page++ ) {
                $posts = get_posts( array( 'post_type' => $type, 'post_status' => array( 'publish', 'draft', 'pending', 'private', 'future' ), 'posts_per_page' => 100, 'paged' => $page, 'orderby' => 'ID', 'order' => 'ASC', 'suppress_filters' => true ) );
                foreach ( $posts as $post ) {
                    if ( '' !== $post->post_password ) { throw new \RuntimeException( 'Password-protected content cannot be exported: ' . $post->ID ); }
                    $row = $this->base( $post, $type );
                    if ( 'post' === $type ) {
                        $row += array( 'excerpt' => $this->html( $post->post_excerpt ), 'commentStatus' => $post->comment_status, 'pingStatus' => $post->ping_status, 'sticky' => is_sticky( $post->ID ), 'format' => get_post_format( $post->ID ) ?: 'standard' );
                    } else {
                        $product = wc_get_product( $post->ID );
                        if ( ! $product ) { throw new \RuntimeException( 'Unreadable product: ' . $post->ID ); }
                        $row += $this->product( $product );
                    }
                    $acf = $this->acf( $post->ID );
                    if ( $acf ) { $row['acf'] = $acf; }
                    $content[] = $row;
                }
                if ( count( $posts ) < 100 ) { break; }
            }
        }
        $payload = array( 'schemaVersion' => 1, 'content' => $content, 'terms' => array_values( $this->terms ), 'attributes' => array_values( $this->attributes ), 'assets' => array_values( $this->assets ) );
        $json = wp_json_encode( $payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
        if ( false === $json || false === file_put_contents( $this->root . '/starter-site-content.json', $json . "\n", LOCK_EX ) ) { throw new \RuntimeException( 'Could not write exported content.' ); }
        return array( 'posts' => count( array_filter( $content, function ( $r ) { return 'post' === $r['kind']; } ) ), 'products' => count( array_filter( $content, function ( $r ) { return 'product' === $r['kind']; } ) ) );
    }

    private function base( $post, $kind ) {
        $row = array( 'id' => 'site-' . $kind . '-' . $post->ID, 'kind' => $kind, 'title' => $post->post_title, 'slug' => rawurldecode( $post->post_name ) ?: 'site-' . $kind . '-' . $post->ID, 'content' => $this->html( $post->post_content ), 'status' => $post->post_status, 'createdAt' => $this->post_date( $post->post_date_gmt ), 'updatedAt' => $this->post_date( $post->post_modified_gmt ), 'publishAt' => $this->post_date( $post->post_date_gmt ), 'categoryIds' => $this->object_terms( $post->ID, 'post' === $kind ? 'category' : 'product_cat' ), 'tagIds' => $this->object_terms( $post->ID, 'post' === $kind ? 'post_tag' : 'product_tag' ) );
        $image = get_post_thumbnail_id( $post->ID );
        if ( $image ) { $row['featuredImageId'] = $this->attachment( $image ); }
        return $row;
    }

    private function post_date( $value ) { return '0000-00-00 00:00:00' === $value ? gmdate( 'c' ) : str_replace( ' ', 'T', $value ) . 'Z'; }
    private function date( $value ) { return $value ? gmdate( 'Y-m-d\TH:i:s\Z', $value->getTimestamp() ) : ''; }
    private function product_ids( $ids ) { return array_map( function ( $id ) { return 'site-product-' . $id; }, $ids ); }

    private function object_terms( $id, $taxonomy ) {
        if ( ! taxonomy_exists( $taxonomy ) ) { return array(); }
        $terms = wp_get_object_terms( $id, $taxonomy );
        if ( is_wp_error( $terms ) ) { throw new \RuntimeException( $terms->get_error_message() ); }
        return array_map( function ( $term ) { return $this->term( $term ); }, $terms );
    }

    private function term( $term ) {
        if ( ! $term || is_wp_error( $term ) ) { throw new \RuntimeException( 'Missing content taxonomy term.' ); }
        $id = 'site-term-' . $term->term_id;
        if ( isset( $this->terms[$id] ) ) { return $id; }
        $this->terms[$id] = array( 'id' => $id, 'taxonomy' => $term->taxonomy, 'name' => $term->name, 'slug' => rawurldecode( $term->slug ), 'description' => $term->description );
        if ( $term->parent ) { $this->terms[$id]['parentId'] = $this->term( get_term( $term->parent, $term->taxonomy ) ); }
        if ( in_array( $term->taxonomy, array( 'product_cat', 'product_brand' ), true ) ) {
            $thumbnail = get_term_meta( $term->term_id, 'thumbnail_id', true );
            if ( $thumbnail ) { $this->terms[$id]['imageId'] = $this->attachment( $thumbnail ); }
        }
        return $id;
    }

    private function attachment( $id, $kind = 'image' ) {
        $logical = 'asset-site-' . $kind . '-' . $id;
        if ( isset( $this->assets[$logical] ) ) { return $logical; }
        $post = get_post( $id );
        if ( ! $post || 'attachment' !== $post->post_type ) { throw new \RuntimeException( 'Missing image attachment: ' . $id ); }
        return $this->asset( get_attached_file( $id ), $logical, $kind, array( 'alt' => (string) get_post_meta( $id, '_wp_attachment_image_alt', true ), 'caption' => $post->post_excerpt, 'description' => $post->post_content ) );
    }

    private function asset( $source, $id, $kind, array $meta = array() ) {
        if ( isset( $this->assets[$id] ) ) { return $id; }
        $uploads = wp_upload_dir();
        $base = realpath( $uploads['basedir'] ); $file = realpath( $source );
        if ( ! $base || ! $file || 0 !== strpos( wp_normalize_path( $file ), trailingslashit( wp_normalize_path( $base ) ) ) || ! is_file( $file ) || ! is_readable( $file ) ) { throw new \RuntimeException( 'Referenced asset must be a readable local upload: ' . $id ); }
        $ext = strtolower( pathinfo( $file, PATHINFO_EXTENSION ) ); if ( 'jpeg' === $ext ) { $ext = 'jpg'; }
        $mimes = 'image' === $kind ? array( 'jpg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp' ) : array( 'pdf' => 'application/pdf', 'txt' => 'text/plain' );
        $size = filesize( $file );
        if ( ! isset( $mimes[$ext] ) || $size <= 0 || $size > ( 'image' === $kind ? 20 : 50 ) * 1024 * 1024 ) { throw new \RuntimeException( 'Unsupported asset type or size: ' . $id ); }
        $this->bytes += $size;
        if ( $this->bytes > 500 * 1024 * 1024 ) { throw new \RuntimeException( 'Exported content assets exceed 500 MiB.' ); }
        $relative = 'sample-assets/' . $id . '.' . $ext;
        if ( ! wp_mkdir_p( $this->root . '/sample-assets' ) || ! copy( $file, $this->root . '/' . $relative ) ) { throw new \RuntimeException( 'Could not copy content asset: ' . $id ); }
        $this->assets[$id] = array_merge( array( 'id' => $id, 'filename' => basename( $file ), 'file' => $relative, 'mime' => $mimes[$ext], 'size' => $size, 'sha256' => hash_file( 'sha256', $this->root . '/' . $relative ), 'kind' => $kind, 'alt' => '', 'caption' => '', 'description' => '' ), $meta );
        return $id;
    }

    private function local_file( $url ) {
        $uploads = wp_upload_dir();
        $base = trailingslashit( $uploads['baseurl'] );
        if ( 0 !== strpos( $url, $base ) || false !== strpbrk( $url, '?#' ) ) { throw new \RuntimeException( 'Downloads must be local uploads without URL parameters.' ); }
        return trailingslashit( $uploads['basedir'] ) . rawurldecode( substr( $url, strlen( $base ) ) );
    }

    private function html( $html ) {
        // Remap local image URLs, including srcset and resized variants, to real bundled attachments.
        $uploads = wp_upload_dir();
        $base = trailingslashit( $uploads['baseurl'] );
        $html = preg_replace_callback( '~' . preg_quote( $base, '~' ) . '[^\s"\'<>]+~', function ( $match ) {
            $url = html_entity_decode( $match[0], ENT_QUOTES, 'UTF-8' );
            $id = attachment_url_to_postid( $url );
            if ( ! $id ) { $id = attachment_url_to_postid( preg_replace( '/-\d+x\d+(?=\.[a-z]+$)/i', '', $url ) ); }
            if ( ! $id ) { throw new \RuntimeException( 'Cannot resolve inline upload: ' . $url ); }
            return '{{sample-asset:' . $this->attachment( $id ) . '}}';
        }, $html );
        $html = preg_replace_callback( '/\b(?:wp-image-|attachment_)(\d+)\b/', function ( $m ) { return str_replace( $m[1], '{{sample-attachment:' . $this->attachment( (int) $m[1] ) . '}}', $m[0] ); }, $html );
        $html = preg_replace_callback( '/<!--\s*wp:(image|gallery|media-text|cover)\s+(\{.*?\})\s*(\/)?-->/s', function ( $m ) {
            $attrs = json_decode( $m[2], true );
            if ( ! is_array( $attrs ) ) { throw new \RuntimeException( 'Invalid media block attributes.' ); }
            foreach ( array( 'id', 'mediaId' ) as $key ) { if ( ! empty( $attrs[$key] ) ) { $attrs[$key] = '{{sample-attachment:' . $this->attachment( (int) $attrs[$key] ) . '}}'; } }
            if ( isset( $attrs['ids'] ) ) { $attrs['ids'] = array_map( function ( $id ) { return '{{sample-attachment:' . $this->attachment( (int) $id ) . '}}'; }, $attrs['ids'] ); }
            return '<!-- wp:' . $m[1] . ' ' . wp_json_encode( $attrs, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . ' ' . ( $m[3] ?? '' ) . '-->';
        }, $html );
        if ( preg_match( '/<!--\s*wp:(?:file|video|audio)\b/', $html ) ) { throw new \RuntimeException( 'Audio, video and file blocks need a supported media adapter before export.' ); }
        $html = preg_replace_callback( '/(\[gallery\b[^\]]*\bids=["\'])([0-9, ]+)(["\'])/', function ( $m ) {
            return $m[1] . implode( ',', array_map( function ( $id ) { return '{{sample-attachment:' . $this->attachment( (int) trim( $id ) ) . '}}'; }, explode( ',', $m[2] ) ) ) . $m[3];
        }, $html );
        return $html;
    }

    private function inventory( $p ) {
        $manage = true === $p->get_manage_stock( 'edit' );
        return array( 'sku' => $p->get_sku( 'edit' ), 'globalUniqueId' => method_exists( $p, 'get_global_unique_id' ) ? $p->get_global_unique_id( 'edit' ) : '', 'manageStock' => $manage, 'quantity' => $manage ? $p->get_stock_quantity( 'edit' ) : null, 'stockStatus' => $p->get_stock_status( 'edit' ), 'backorders' => $manage ? $p->get_backorders( 'edit' ) : 'no', 'lowStockThreshold' => $manage && '' !== $p->get_low_stock_amount( 'edit' ) ? (int) $p->get_low_stock_amount( 'edit' ) : null, 'soldIndividually' => $p->get_sold_individually( 'edit' ) );
    }
    private function shipping( $p ) {
        $row = array( 'weight' => $p->get_weight( 'edit' ), 'length' => $p->get_length( 'edit' ), 'width' => $p->get_width( 'edit' ), 'height' => $p->get_height( 'edit' ) );
        if ( $p->get_shipping_class_id( 'edit' ) ) { $row['classId'] = $this->term( get_term( $p->get_shipping_class_id( 'edit' ), 'product_shipping_class' ) ); }
        return $row;
    }
    private function pricing( $p ) { return array( 'regularPrice' => $p->get_regular_price( 'edit' ), 'salePrice' => $p->get_sale_price( 'edit' ), 'saleFrom' => $this->date( $p->get_date_on_sale_from( 'edit' ) ), 'saleTo' => $this->date( $p->get_date_on_sale_to( 'edit' ) ) ); }
    private function downloads( $p ) {
        $rows = array();
        foreach ( $p->get_downloads( 'edit' ) as $key => $download ) {
            $id = 'asset-site-download-' . $p->get_id() . '-' . substr( hash( 'sha256', (string) $key ), 0, 20 );
            $rows[] = array( 'id' => 'site-download-' . substr( hash( 'sha256', $id ), 0, 24 ), 'name' => $download->get_name() ?: 'Download', 'assetId' => $this->asset( $this->local_file( $download->get_file() ), $id, 'download' ) );
        }
        return array( 'virtual' => $p->get_virtual( 'edit' ), 'downloadable' => $p->get_downloadable( 'edit' ), 'downloads' => $rows, 'downloadLimit' => $p->get_download_limit( 'edit' ) < 0 ? null : $p->get_download_limit( 'edit' ), 'downloadExpiry' => $p->get_download_expiry( 'edit' ) < 0 ? null : $p->get_download_expiry( 'edit' ) );
    }

    private function product( $p ) {
        $type = $p->get_type();
        if ( ! in_array( $type, array( 'simple', 'variable', 'grouped', 'external' ), true ) ) { throw new \RuntimeException( 'Unsupported product type ' . $type . ': ' . $p->get_id() ); }
        $attrs = array(); $attr_keys = array();
        foreach ( $p->get_attributes( 'edit' ) as $key => $a ) {
            $id = 'site-attribute-' . $p->get_id() . '-' . count( $attrs );
            $row = array( 'id' => $id, 'name' => $a->get_name(), 'visible' => $a->get_visible(), 'variation' => $a->get_variation(), 'options' => array() );
            if ( $a->is_taxonomy() ) {
                $global = wc_get_attribute( $a->get_id() );
                if ( ! $global ) { throw new \RuntimeException( 'Missing global attribute.' ); }
                $gid = 'site-global-' . $a->get_id();
                $this->attributes[$gid] = array( 'id' => $gid, 'name' => $global->name, 'slug' => substr( $global->slug, 3 ), 'type' => $global->type, 'orderBy' => $global->order_by, 'hasArchives' => (bool) $global->has_archives );
                $row['globalId'] = $gid; $row['name'] = $global->name;
                foreach ( $a->get_options() as $term_id ) { $row['options'][] = $this->term( get_term( $term_id, $a->get_name() ) ); }
            } else { $row['options'] = array_values( $a->get_options() ); }
            $attrs[] = $row; $attr_keys[$key] = array( 'id' => $id, 'taxonomy' => $a->is_taxonomy() ? $a->get_name() : '', 'options' => $row['options'] );
        }
        $row = array( 'productType' => $type, 'shortDescription' => $this->html( $p->get_short_description( 'edit' ) ), 'brandIds' => $this->object_terms( $p->get_id(), 'product_brand' ), 'galleryIds' => array_map( array( $this, 'attachment' ), $p->get_gallery_image_ids( 'edit' ) ), 'catalogVisibility' => $p->get_catalog_visibility( 'edit' ), 'featured' => $p->get_featured( 'edit' ), 'inventory' => $this->inventory( $p ), 'shipping' => $this->shipping( $p ), 'taxStatus' => $p->get_tax_status( 'edit' ), 'taxClass' => $p->get_tax_class( 'edit' ), 'upsellIds' => $this->product_ids( $p->get_upsell_ids( 'edit' ) ), 'crossSellIds' => $this->product_ids( $p->get_cross_sell_ids( 'edit' ) ), 'attributes' => $attrs, 'purchaseNote' => $this->html( $p->get_purchase_note( 'edit' ) ), 'menuOrder' => $p->get_menu_order( 'edit' ), 'reviewsAllowed' => $p->get_reviews_allowed( 'edit' ) );
        if ( 'simple' === $type ) { $row += array( 'pricing' => $this->pricing( $p ) ) + $this->downloads( $p ); }
        if ( 'external' === $type ) { $row += array( 'pricing' => $this->pricing( $p ), 'externalUrl' => $p->get_product_url( 'edit' ), 'buttonText' => $p->get_button_text( 'edit' ) ); }
        if ( 'grouped' === $type ) { $row['childrenIds'] = $this->product_ids( $p->get_children( 'edit' ) ); }
        if ( 'variable' === $type ) {
            $row['defaultAttributes'] = (object) $this->attribute_values( $p->get_default_attributes( 'edit' ), $attr_keys ); $row['variations'] = array();
            $children = get_posts( array( 'post_type' => 'product_variation', 'post_parent' => $p->get_id(), 'post_status' => array( 'publish', 'private' ), 'posts_per_page' => -1, 'orderby' => 'menu_order ID', 'order' => 'ASC' ) );
            foreach ( $children as $child ) {
                $v = wc_get_product( $child->ID );
                if ( ! $v ) { throw new \RuntimeException( 'Missing variation: ' . $child->ID ); }
                $variation = array( 'id' => 'site-variation-' . $child->ID, 'menuOrder' => $v->get_menu_order( 'edit' ), 'attributes' => (object) $this->attribute_values( $v->get_attributes( 'edit' ), $attr_keys ), 'enabled' => 'publish' === $v->get_status( 'edit' ), 'description' => $this->html( $v->get_description( 'edit' ) ), 'pricing' => $this->pricing( $v ), 'inventory' => $this->inventory( $v ), 'shipping' => $this->shipping( $v ), 'taxClass' => $v->get_tax_class( 'edit' ) ) + $this->downloads( $v );
                if ( $v->get_image_id( 'edit' ) ) { $variation['imageId'] = $this->attachment( $v->get_image_id( 'edit' ) ); }
                $row['variations'][] = $variation;
            }
        }
        return $row;
    }
    private function attribute_values( $values, $keys ) {
        $out = array();
        foreach ( $values as $key => $value ) {
            if ( ! isset( $keys[$key] ) ) { throw new \RuntimeException( 'Unresolved variation attribute: ' . $key ); }
            $attr = $keys[$key];
            if ( '' !== $value && ! $attr['taxonomy'] && ! in_array( $value, $attr['options'], true ) ) {
                foreach ( $attr['options'] as $option ) { if ( sanitize_title( $option ) === sanitize_title( $value ) ) { $value = $option; break; } }
            }
            $out[$attr['id']] = '' !== $value && $attr['taxonomy'] ? $this->term( get_term_by( 'slug', $value, $attr['taxonomy'] ) ) : rawurldecode( $value );
        }
        return $out;
    }

    private function acf( $post_id ) {
        if ( ! function_exists( 'acf_get_field_groups' ) ) { return null; }
        $groups = array(); $values = array();
        foreach ( acf_get_field_groups( array( 'post_id' => $post_id ) ) as $group ) {
            $fields = acf_get_fields( $group );
            if ( ! $fields ) { continue; }
            $definitions = array();
            foreach ( $fields as $field ) {
                $definitions[] = $this->acf_field( $field );
                $values[$field['key']] = $this->acf_value( $field, acf_get_value( $post_id, $field ) );
            }
            foreach ( $group['location'] as $rules ) {
                foreach ( $rules as $rule ) {
                    if ( 'post_type' !== $rule['param'] || '==' !== $rule['operator'] || ! in_array( $rule['value'], array( 'post', 'product' ), true ) ) { throw new \RuntimeException( 'ACF group needs portable post_type location rules: ' . $group['title'] ); }
                }
            }
            $groups[] = array( 'key' => $group['key'], 'title' => $group['title'], 'fields' => $definitions, 'location' => $group['location'] );
        }
        return $groups ? array( 'groups' => $groups, 'values' => (object) $values ) : null;
    }

    private function acf_field( $field, $depth = 0 ) {
        $types = array( 'text', 'textarea', 'number', 'range', 'email', 'url', 'wysiwyg', 'select', 'checkbox', 'radio', 'button_group', 'true_false', 'date_picker', 'date_time_picker', 'time_picker', 'color_picker', 'link', 'file', 'image', 'gallery', 'post_object', 'relationship', 'taxonomy', 'group', 'repeater', 'flexible_content', 'tab', 'accordion', 'message' );
        if ( $depth > 20 || ! in_array( $field['type'], $types, true ) ) { throw new \RuntimeException( 'Unsupported ACF field type: ' . $field['name'] . ' (' . $field['type'] . ')' ); }
        if ( 0 === strpos( $field['name'], '_' ) || preg_match( '/password|secret|token|credential|api[_-]?key/i', $field['name'] ) ) { throw new \RuntimeException( 'Credential or reserved ACF field cannot be exported: ' . $field['name'] ); }
        $keys = explode( ' ', 'key name label type instructions required choices return_format multiple allow_null ui ajax min max step prepend append placeholder maxlength rows new_lines toolbar media_upload tabs display_format first_day layout button_label collapsed min_width min_height max_width max_height min_size max_size mime_types preview_size library post_type taxonomy field_type save_terms load_terms add_term filters elements conditional_logic wrapper message esc_html endpoint placement' );
        $out = array_intersect_key( $field, array_flip( $keys ) );
        // An empty PHP choices array is a map in the portable format too.
        if ( isset( $out['choices'] ) ) { $out['choices'] = (object) $out['choices']; }
        if ( isset( $field['sub_fields'] ) ) { $out['sub_fields'] = array_map( function ( $f ) use ( $depth ) { return $this->acf_field( $f, $depth + 1 ); }, $field['sub_fields'] ); }
        if ( isset( $field['layouts'] ) ) {
            $out['layouts'] = array();
            foreach ( $field['layouts'] as $layout ) { $copy = array_intersect_key( $layout, array_flip( array( 'key', 'name', 'label', 'display', 'min', 'max' ) ) ); $copy['sub_fields'] = array_map( function ( $f ) use ( $depth ) { return $this->acf_field( $f, $depth + 1 ); }, $layout['sub_fields'] ); $out['layouts'][] = $copy; }
        }
        return $out;
    }

    private function acf_value( $field, $value ) {
        if ( null === $value || false === $value || '' === $value ) { return $value; }
        switch ( $field['type'] ) {
            case 'file':
                $ext = strtolower( pathinfo( get_attached_file( (int) $value ), PATHINFO_EXTENSION ) );
                return array( '$siteRef' => 'asset', 'id' => $this->attachment( (int) $value, in_array( $ext, array( 'png', 'jpg', 'jpeg', 'gif', 'webp' ), true ) ? 'image' : 'document' ) );
            case 'image': return array( '$siteRef' => 'asset', 'id' => $this->attachment( (int) $value ) );
            case 'gallery': return array_map( function ( $id ) { return array( '$siteRef' => 'asset', 'id' => $this->attachment( (int) $id ) ); }, (array) $value );
            case 'relationship': case 'post_object':
                $resolve = function ( $id ) { $post = get_post( $id ); if ( ! $post || ! in_array( $post->post_type, array( 'post', 'product' ), true ) || ! in_array( $post->post_status, array( 'publish', 'draft', 'pending', 'private', 'future' ), true ) ) { throw new \RuntimeException( 'ACF references content outside the exported posts/products: ' . $id ); } return array( '$siteRef' => 'content', 'id' => 'site-' . $post->post_type . '-' . $id ); };
                return is_array( $value ) ? array_map( $resolve, $value ) : $resolve( $value );
            case 'taxonomy':
                $resolve = function ( $id ) use ( $field ) { $taxonomy = $field['taxonomy']; if ( ! in_array( $taxonomy, array( 'category', 'post_tag', 'product_cat', 'product_tag', 'product_brand', 'product_shipping_class' ), true ) ) { throw new \RuntimeException( 'Unsupported ACF taxonomy: ' . $taxonomy ); } return array( '$siteRef' => 'term', 'id' => $this->term( get_term( $id, $taxonomy ) ) ); };
                return is_array( $value ) ? array_map( $resolve, $value ) : $resolve( $value );
            case 'group': return $this->acf_subvalues( $field['sub_fields'], (array) $value );
            case 'repeater': return array_map( function ( $row ) use ( $field ) { return $this->acf_subvalues( $field['sub_fields'], $row ); }, (array) $value );
            case 'flexible_content':
                return array_map( function ( $row ) use ( $field ) { foreach ( $field['layouts'] as $layout ) { if ( $layout['name'] === ( $row['acf_fc_layout'] ?? '' ) ) { return array_merge( array( 'acf_fc_layout' => $layout['name'] ), $this->acf_subvalues( $layout['sub_fields'], $row ) ); } } throw new \RuntimeException( 'Unresolved ACF flexible layout.' ); }, (array) $value );
            case 'wysiwyg': return $this->html( (string) $value );
            default: return $value;
        }
    }
    private function acf_subvalues( $fields, $value ) {
        $out = array();
        foreach ( $fields as $field ) { $out[$field['key']] = $this->acf_value( $field, $value[$field['key']] ?? $value[$field['name']] ?? null ); }
        return $out;
    }
}
