<?php
/** Offline sample-content provisioning. Loaded by the one-time bootstrap only. */
if ( ! defined( 'ABSPATH' ) ) { exit; }

final class MMS_WP_Starter_Sample_Content {
    const OWNERSHIP_META = '_wp_starter_sample_id';
    const STATE_OPTION = 'mms_wp_starter_sample_progress';
    const LOCK_OPTION = 'mms_wp_starter_sample_lock';

    private $payload;
    private $root;

    public function __construct( array $payload, $root ) {
        $this->payload = $payload;
        $this->root = $root;
    }

    private function error( $code, $message ) {
        return new WP_Error( 'sample_' . $code, $message );
    }

    /** Advance one bounded unit. Persist progress before the caller redirects. */
    public function step() {
        $validation = $this->validate();
        if ( is_wp_error( $validation ) ) { return $validation; }
        $fingerprint = hash( 'sha256', wp_json_encode( $this->payload ) );
        $state = get_option( self::STATE_OPTION, array() );
        if ( ! empty( $state['fingerprint'] ) && $state['fingerprint'] !== $fingerprint ) { return $this->error( 'payload_changed', 'Sample payload changed during installation; restore the original build payload.' ); }
        $state = array_merge( array( 'fingerprint' => $fingerprint, 'phase' => 'attributes', 'index' => 0 ), (array) $state );
        if ( 'done' === $state['phase'] ) { return true; }
        // add_option is atomic. Do not steal a live lock; a stale one can be
        // cleared after a terminated request. The finally block handles errors.
        $owner = wp_generate_uuid4();
        $lock = get_option( self::LOCK_OPTION );
        if ( is_array( $lock ) && ( $lock['time'] ?? 0 ) < time() - 900 ) { delete_option( self::LOCK_OPTION ); }
        if ( ! add_option( self::LOCK_OPTION, array( 'owner' => $owner, 'time' => time() ), '', false ) ) { return $this->error( 'busy', 'Another sample installation request is running. Retry after it completes.' ); }
        try {
            $phases = array( 'attributes', 'terms', 'assets', 'content', 'relationships', 'publish', 'verify' );
            $phase_index = array_search( $state['phase'], $phases, true );
            if ( false === $phase_index ) { return $this->error( 'state', 'Invalid sample installation phase.' ); }
            $rows = 'terms' === $state['phase'] ? $this->ordered_terms() : $this->payload[ in_array( $state['phase'], array( 'attributes', 'assets' ), true ) ? $state['phase'] : 'content' ];
            if ( is_wp_error( $rows ) ) { return $rows; }
            if ( $state['index'] < count( $rows ) ) {
                $row = $rows[$state['index']];
                switch ( $state['phase'] ) {
                    case 'attributes': $result = $this->install_attribute( $row ); break;
                    case 'terms': $result = $this->install_term( $row ); break;
                    case 'assets': $result = $this->install_asset( $row ); break;
                    case 'content': $result = 'post' === $row['kind'] ? $this->install_post( $row ) : $this->install_product( $row ); break;
                    case 'relationships': $result = 'product' === $row['kind'] ? $this->link_product( $row ) : true; break;
                    case 'publish': $result = $this->publish_row( $row ); break;
                    default: $result = $this->verify_row( $row ); break;
                }
                if ( is_wp_error( $result ) ) { return $result; }
                $state['index']++;
            } else {
                $state['phase'] = $phases[$phase_index + 1] ?? 'done';
                $state['index'] = 0;
            }
            update_option( self::STATE_OPTION, $state, false );
            return 'done' === $state['phase'];
        } catch ( Throwable $error ) {
            return $this->error( 'installation', $error->getMessage() );
        } finally {
            $lock = get_option( self::LOCK_OPTION );
            if ( is_array( $lock ) && ( $lock['owner'] ?? '' ) === $owner ) { delete_option( self::LOCK_OPTION ); }
        }
    }

    public function verify_row( array $row ) {
        $id = $this->owned_post( $row['id'], $row['kind'] );
        if ( is_wp_error( $id ) ) { return $id; }
        $post = $id ? get_post( $id ) : null;
        if ( ! $post || ! self::same_slug( $post->post_name, $row['slug'] ) || $post->post_title !== sanitize_text_field( $row['title'] ) ) { return $this->error( 'verification', 'Sample title/slug mismatch for ' . $row['id'] ); }
        $expected = 'future' === $row['status'] && strtotime( $row['publishAt'] ) <= time() ? 'publish' : $row['status'];
        if ( $post->post_status !== $expected ) { return $this->error( 'verification', 'Sample status mismatch for ' . $row['id'] ); }
        foreach ( array( 'categoryIds' => 'post' === $row['kind'] ? 'category' : 'product_cat', 'tagIds' => 'post' === $row['kind'] ? 'post_tag' : 'product_tag' ) as $key => $taxonomy ) {
            $expected_ids = $this->resolve_term_ids( $row[$key] ?? array(), $taxonomy );
            if ( is_wp_error( $expected_ids ) ) { return $expected_ids; }
            $actual = wp_get_object_terms( $id, $taxonomy, array( 'fields' => 'ids' ) );
            if ( is_wp_error( $actual ) ) { return $actual; }
            $actual = array_map( 'intval', $actual ); sort( $actual ); sort( $expected_ids );
            if ( $actual !== $expected_ids ) { return $this->error( 'verification', 'Sample taxonomy assignment mismatch for ' . $row['id'] . ':' . $taxonomy ); }
        }
        return true;
    }

    /** Image attachments and downloadable files have distinct destinations. */
    public function install_asset( array $row ) {
        $source = $this->asset_file( $row );
        if ( is_wp_error( $source ) ) { return $source; }
        if ( hash_file( 'sha256', $source ) !== $row['sha256'] ) { return $this->error( 'asset_integrity', 'Sample asset bytes changed.' ); }
        require_once ABSPATH . 'wp-admin/includes/file.php';
        if ( 'download' === $row['kind'] ) {
            $uploads = wp_upload_dir();
            if ( ! empty( $uploads['error'] ) ) { return $this->error( 'uploads', $uploads['error'] ); }
            // Never use the public attachment library for sample downloads.
            // Apache protection is explicit; other servers must supply an
            // equivalent administrator-controlled rule before setup continues.
            if ( false === stripos( $_SERVER['SERVER_SOFTWARE'] ?? '', 'apache' ) && ! apply_filters( 'wp_starter_sample_downloads_protected', false ) ) {
                return $this->error( 'download_protection', 'Configure web-server denial of direct access to uploads/woocommerce_uploads and return true from wp_starter_sample_downloads_protected before installing sample downloads on this server.' );
            }
            $directory = $uploads['basedir'] . '/woocommerce_uploads/wp-starter-samples';
            if ( ! wp_mkdir_p( $directory ) ) { return $this->error( 'download_directory', 'Cannot create protected sample download directory.' ); }
            $rule = "<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n";
            if ( false === file_put_contents( $directory . '/.htaccess', $rule ) || false === file_put_contents( $directory . '/index.html', '' ) ) { return $this->error( 'download_protection', 'Could not write sample download protection files.' ); }
            $filename = basename( $row['file'] );
            $target = $directory . '/' . $filename;
            if ( is_file( $target ) && hash_file( 'sha256', $target ) !== $row['sha256'] ) { return $this->error( 'download_conflict', 'Existing sample download differs from the build.' ); }
            if ( ! is_file( $target ) && ! copy( $source, $target ) ) { return $this->error( 'download_copy', 'Could not copy sample download.' ); }
            $url = $uploads['baseurl'] . '/woocommerce_uploads/wp-starter-samples/' . $filename;
            $files = (array) get_option( 'mms_wp_starter_sample_downloads', array() );
            $files[$row['id']] = array( 'url' => $url, 'sha256' => $row['sha256'] );
            update_option( 'mms_wp_starter_sample_downloads', $files, false );
            return true;
        }
        require_once ABSPATH . 'wp-admin/includes/image.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        $existing = $this->owned_post( $row['id'], 'attachment' );
        if ( is_wp_error( $existing ) ) { return $existing; }
        if ( $existing ) {
            $file = get_attached_file( $existing );
            if ( ! $file || ! is_file( $file ) || hash_file( 'sha256', $file ) !== $row['sha256'] ) { return $this->error( 'media_integrity', 'Owned sample attachment is missing or differs from the build.' ); }
            return $existing;
        }
        $mime = wp_get_image_mime( $source );
        if ( ! in_array( $mime, array( 'image/png', 'image/jpeg', 'image/gif', 'image/webp' ), true ) || $mime !== $row['mime'] ) { return $this->error( 'image_type', 'Invalid sample image bytes or MIME type.' ); }
        $uploads = wp_upload_dir();
        if ( ! empty( $uploads['error'] ) ) { return $this->error( 'uploads', $uploads['error'] ); }
        $directory = $uploads['basedir'] . '/wp-starter-samples';
        if ( ! wp_mkdir_p( $directory ) ) { return $this->error( 'media_directory', 'Could not create sample image directory.' ); }
        $target = $directory . '/' . basename( $row['file'] );
        if ( is_file( $target ) && hash_file( 'sha256', $target ) !== $row['sha256'] ) { return $this->error( 'media_conflict', 'Existing destination sample file has different bytes.' ); }
        if ( ! is_file( $target ) && ! copy( $source, $target ) ) { return $this->error( 'media_copy', 'Could not copy sample image.' ); }
        $attachment = wp_insert_attachment( wp_slash( array( 'post_mime_type' => $mime, 'post_title' => sanitize_text_field( pathinfo( $row['filename'], PATHINFO_FILENAME ) ), 'post_excerpt' => wp_kses_post( $row['caption'] ), 'post_content' => wp_kses_post( $row['description'] ), 'post_status' => 'inherit', 'meta_input' => array( self::OWNERSHIP_META => $row['id'], '_wp_attachment_image_alt' => sanitize_text_field( $row['alt'] ) ) ) ), $target, 0, true );
        if ( is_wp_error( $attachment ) ) { return $attachment; }
        $metadata = wp_generate_attachment_metadata( $attachment, $target );
        if ( is_wp_error( $metadata ) ) { return $metadata; }
        wp_update_attachment_metadata( $attachment, $metadata );
        return (int) $attachment;
    }

    private function product_values( $product, array $row, $variation = false ) {
        $inventory = $row['inventory'];
        $sku = (string) $inventory['sku'];
        if ( $sku ) {
            $owner = wc_get_product_id_by_sku( $sku );
            if ( $owner && (int) $owner !== (int) $product->get_id() ) { return $this->error( 'sku_conflict', 'An unrelated product already uses SKU ' . $sku . '.' ); }
        }
        $product->set_sku( $sku );
        if ( ! empty( $inventory['globalUniqueId'] ) ) {
            if ( ! method_exists( $product, 'set_global_unique_id' ) ) { return $this->error( 'unique_id_support', 'This WooCommerce version does not support global unique IDs.' ); }
            $product->set_global_unique_id( $inventory['globalUniqueId'] );
        }
        $product->set_manage_stock( $inventory['manageStock'] );
        $product->set_stock_quantity( $inventory['manageStock'] ? $inventory['quantity'] : null );
        $product->set_stock_status( $inventory['stockStatus'] );
        $product->set_backorders( $inventory['backorders'] );
        $product->set_low_stock_amount( $inventory['lowStockThreshold'] ?? '' );
        $product->set_sold_individually( $inventory['soldIndividually'] );
        foreach ( array( 'weight', 'length', 'width', 'height' ) as $dimension ) { $product->{ 'set_' . $dimension }( $row['shipping'][$dimension] ); }
        $shipping = $this->resolve_term_ids( empty( $row['shipping']['classId'] ) ? array() : array( $row['shipping']['classId'] ), 'product_shipping_class' );
        if ( is_wp_error( $shipping ) ) { return $shipping; }
        $product->set_shipping_class_id( $shipping[0] ?? 0 );
        $tax_class = $row['taxClass'] ?? '';
        if ( '' !== $tax_class && ! ( $variation && 'parent' === $tax_class ) && ! in_array( $tax_class, WC_Tax::get_tax_class_slugs(), true ) ) { return $this->error( 'tax_class', 'Unknown destination tax class ' . $tax_class . '.' ); }
        $product->set_tax_class( $tax_class );
        if ( isset( $row['pricing'] ) ) {
            $pricing = $row['pricing'];
            $product->set_regular_price( $pricing['regularPrice'] );
            $product->set_sale_price( $pricing['salePrice'] );
            $product->set_date_on_sale_from( empty( $pricing['saleFrom'] ) ? null : strtotime( $pricing['saleFrom'] ) );
            $product->set_date_on_sale_to( empty( $pricing['saleTo'] ) ? null : strtotime( $pricing['saleTo'] ) );
        }
        if ( array_key_exists( 'virtual', $row ) ) { $product->set_virtual( $row['virtual'] ); }
        if ( array_key_exists( 'downloadable', $row ) ) {
            $files = array();
            $installed = (array) get_option( 'mms_wp_starter_sample_downloads', array() );
            foreach ( $row['downloads'] as $download ) {
                $saved = $installed[$download['assetId']] ?? null;
                if ( ! $saved ) { return $this->error( 'download_reference', 'Protected sample download is not installed: ' . $download['assetId'] ); }
                $file = new WC_Product_Download();
                $file->set_id( $download['id'] ); $file->set_name( $download['name'] ); $file->set_file( $saved['url'] );
                $files[] = $file;
            }
            $product->set_downloadable( $row['downloadable'] ); $product->set_downloads( $files );
            $product->set_download_limit( $row['downloadLimit'] ?? -1 ); $product->set_download_expiry( $row['downloadExpiry'] ?? -1 );
        }
        return true;
    }

    private function attribute_key( array $attribute ) {
        if ( empty( $attribute['globalId'] ) ) { return sanitize_title( $attribute['name'] ); }
        foreach ( $this->payload['attributes'] as $global ) {
            if ( $global['id'] === $attribute['globalId'] ) { return 'pa_' . $global['slug']; }
        }
        return '';
    }

    private function attribute_values( array $row, array $values ) {
        $result = array();
        foreach ( $values as $logical => $value ) {
            $found = false;
            foreach ( $row['attributes'] as $attribute ) {
                if ( $attribute['id'] !== $logical ) { continue; }
                $found = true;
                if ( ! $attribute['variation'] || ( '' !== $value && ! in_array( $value, $attribute['options'], true ) ) ) { return $this->error( 'attribute_value', 'Invalid variation value for ' . $logical ); }
                $key = $this->attribute_key( $attribute );
                if ( ! $key ) { return $this->error( 'attribute_reference', 'Missing global attribute definition.' ); }
                if ( ! empty( $attribute['globalId'] ) && '' !== $value ) {
                    $term = $this->term_row( $value );
                    if ( ! $term || $term['taxonomy'] !== $key ) { return $this->error( 'attribute_reference', 'Invalid global attribute term.' ); }
                    $result[$key] = $term['slug'];
                } else { $result[$key] = $value; }
                break;
            }
            if ( ! $found ) { return $this->error( 'attribute_reference', 'Unknown variation attribute ' . $logical ); }
        }
        return $result;
    }

    public function install_product( array $row ) {
        $id = $this->owned_post( $row['id'], 'product' );
        if ( is_wp_error( $id ) ) { return $id; }
        $conflict = get_page_by_path( $row['slug'], OBJECT, 'product' );
        if ( $conflict && (int) $conflict->ID !== $id ) { return $this->error( 'slug_conflict', 'An unrelated product uses slug ' . $row['slug'] ); }
        $classes = array( 'simple' => 'WC_Product_Simple', 'variable' => 'WC_Product_Variable', 'grouped' => 'WC_Product_Grouped', 'external' => 'WC_Product_External' );
        $class = $classes[$row['productType']] ?? '';
        if ( ! $class || ! class_exists( $class ) ) { return $this->error( 'product_type', 'Unsupported WooCommerce product type.' ); }
        $product = new $class( $id );
        $product->set_name( $row['title'] ); $product->set_slug( $row['slug'] ); $product->set_status( 'draft' );
        $content = $this->content_html( $row['content'] ); $excerpt = $this->content_html( $row['shortDescription'] );
        if ( is_wp_error( $content ) ) { return $content; } if ( is_wp_error( $excerpt ) ) { return $excerpt; }
        $product->set_description( $content ); $product->set_short_description( $excerpt );
        $product->set_catalog_visibility( $row['catalogVisibility'] ); $product->set_featured( $row['featured'] );
        $product->set_menu_order( $row['menuOrder'] ); $product->set_reviews_allowed( $row['reviewsAllowed'] );
        $product->set_purchase_note( wp_kses_post( $row['purchaseNote'] ) ); $product->set_tax_status( $row['taxStatus'] );
        $values = $this->product_values( $product, $row ); if ( is_wp_error( $values ) ) { return $values; }
        $categories = $this->resolve_term_ids( $row['categoryIds'], 'product_cat' ); $tags = $this->resolve_term_ids( $row['tagIds'], 'product_tag' );
        if ( is_wp_error( $categories ) ) { return $categories; } if ( is_wp_error( $tags ) ) { return $tags; }
        $product->set_category_ids( $categories ); $product->set_tag_ids( $tags );
        $brands = $this->resolve_term_ids( $row['brandIds'], 'product_brand' ); if ( is_wp_error( $brands ) ) { return $brands; }
        if ( $brands && ! taxonomy_exists( 'product_brand' ) ) { return $this->error( 'brands', 'WooCommerce core brands are not available.' ); }
        $image = $this->attachment_id( $row['featuredImageId'] ?? '' ); if ( is_wp_error( $image ) ) { return $image; } $product->set_image_id( $image );
        $gallery = array(); foreach ( $row['galleryIds'] as $logical ) { $image = $this->attachment_id( $logical ); if ( is_wp_error( $image ) ) { return $image; } $gallery[] = $image; } $product->set_gallery_image_ids( $gallery );
        $attributes = array();
        foreach ( $row['attributes'] as $source ) {
            $attribute = new WC_Product_Attribute();
            $name = empty( $source['globalId'] ) ? $source['name'] : $this->attribute_key( $source );
            if ( ! $name ) { return $this->error( 'attribute_reference', 'Missing global attribute.' ); }
            $attribute->set_name( $name );
            if ( ! empty( $source['globalId'] ) ) {
                $attribute_id = wc_attribute_taxonomy_id_by_name( $name );
                if ( ! $attribute_id || ! taxonomy_exists( $name ) ) { return $this->error( 'attribute_registration', 'Global attribute is not registered: ' . $name ); }
                $attribute->set_id( $attribute_id );
                $terms = $this->resolve_term_ids( $source['options'], $name ); if ( is_wp_error( $terms ) ) { return $terms; } $attribute->set_options( $terms );
            } else { $attribute->set_id( 0 ); $attribute->set_options( $source['options'] ); }
            $attribute->set_position( count( $attributes ) ); $attribute->set_visible( $source['visible'] ); $attribute->set_variation( $source['variation'] ); $attributes[] = $attribute;
        }
        $product->set_attributes( $attributes );
        if ( 'external' === $row['productType'] ) { $product->set_product_url( esc_url_raw( $row['externalUrl'], array( 'http', 'https' ) ) ); $product->set_button_text( $row['buttonText'] ); }
        if ( 'variable' === $row['productType'] ) { $defaults = $this->attribute_values( $row, $row['defaultAttributes'] ); if ( is_wp_error( $defaults ) ) { return $defaults; } $product->set_default_attributes( $defaults ); }
        $product->update_meta_data( self::OWNERSHIP_META, $row['id'] );
        $saved = $product->save(); if ( ! $saved ) { return $this->error( 'product_save', 'Could not save sample product.' ); }
        if ( taxonomy_exists( 'product_brand' ) ) { $assigned = wp_set_object_terms( $saved, $brands, 'product_brand', false ); if ( is_wp_error( $assigned ) ) { return $assigned; } }
        if ( 'variable' === $row['productType'] ) {
            foreach ( $row['variations'] as $source ) {
                $variation_id = $this->owned_post( $source['id'], 'product_variation' ); if ( is_wp_error( $variation_id ) ) { return $variation_id; }
                $variation = new WC_Product_Variation( $variation_id );
                if ( $variation_id && (int) $variation->get_parent_id() !== (int) $saved ) { return $this->error( 'variation_parent', 'Existing owned variation belongs to a different parent.' ); }
                $variation->set_parent_id( $saved ); $variation->set_status( $source['enabled'] ? 'publish' : 'private' );
                $variation->set_description( wp_kses_post( $source['description'] ) );
                $attrs = $this->attribute_values( $row, $source['attributes'] ); if ( is_wp_error( $attrs ) ) { return $attrs; } $variation->set_attributes( $attrs );
                $image = $this->attachment_id( $source['imageId'] ?? '' ); if ( is_wp_error( $image ) ) { return $image; } $variation->set_image_id( $image );
                $values = $this->product_values( $variation, $source, true ); if ( is_wp_error( $values ) ) { return $values; }
                $variation->update_meta_data( self::OWNERSHIP_META, $source['id'] );
                if ( ! $variation->save() ) { return $this->error( 'variation_save', 'Could not save variation ' . $source['id'] ); }
            }
        }
        return (int) $saved;
    }

    public function link_product( array $row ) {
        $id = $this->owned_post( $row['id'], 'product' ); if ( is_wp_error( $id ) ) { return $id; }
        $product = wc_get_product( $id ); if ( ! $product ) { return $this->error( 'product_missing', 'Missing sample product ' . $row['id'] ); }
        foreach ( array( 'upsellIds' => 'set_upsell_ids', 'crossSellIds' => 'set_cross_sell_ids', 'childrenIds' => 'set_children' ) as $field => $setter ) {
            if ( 'childrenIds' === $field && 'grouped' !== $row['productType'] ) { continue; }
            $ids = array();
            foreach ( $row[$field] ?? array() as $logical ) { $linked = $this->owned_post( $logical, 'product' ); if ( is_wp_error( $linked ) ) { return $linked; } if ( ! $linked ) { return $this->error( 'linked_product', 'Linked sample product is missing: ' . $logical ); } $ids[] = $linked; }
            $product->$setter( $ids );
        }
        $product->save();
        if ( 'variable' === $row['productType'] ) { WC_Product_Variable::sync( $id ); }
        if ( 'grouped' === $row['productType'] ) { WC_Product_Grouped::sync( $id ); }
        wc_delete_product_transients( $id );
        return true;
    }

    /** Validate the portable boundary before calling any WordPress mutation API. */
    public function validate() {
        if ( ( $this->payload['schemaVersion'] ?? null ) !== 1 ) { return $this->error( 'schema', 'Unsupported sample payload schema.' ); }
        foreach ( array( 'content', 'terms', 'attributes', 'assets' ) as $key ) {
            if ( ! isset( $this->payload[$key] ) || ! is_array( $this->payload[$key] ) ) { return $this->error( 'schema', 'Missing sample list: ' . $key ); }
            $ids = array();
            foreach ( $this->payload[$key] as $row ) {
                if ( ! is_array( $row ) || ! preg_match( '/^[a-z][a-z0-9-]{0,79}$/D', $row['id'] ?? '' ) || isset( $ids[$row['id']] ) ) { return $this->error( 'schema', 'Invalid or duplicate sample identity in ' . $key ); }
                $ids[$row['id']] = true;
            }
        }
        $total = 0;
        foreach ( $this->payload['assets'] as $row ) {
            $file = $this->asset_file( $row );
            if ( is_wp_error( $file ) ) { return $file; }
            $size = filesize( $file );
            $limit = ( 'image' === ( $row['kind'] ?? '' ) ? 20 : 50 ) * 1024 * 1024;
            if ( ! $size || $size > $limit || $size !== ( $row['size'] ?? null ) || ! preg_match( '/^[a-f0-9]{64}$/D', $row['sha256'] ?? '' ) || hash_file( 'sha256', $file ) !== $row['sha256'] ) { return $this->error( 'asset_integrity', 'Sample asset failed size/checksum verification: ' . $row['id'] ); }
            $total += $size;
        }
        if ( $total > 500 * 1024 * 1024 ) { return $this->error( 'asset_limit', 'Selected sample assets exceed 500 MiB.' ); }
        foreach ( $this->payload['content'] as $row ) {
            if ( ! in_array( $row['kind'] ?? '', array( 'post', 'product' ), true ) || ! is_string( $row['title'] ?? null ) || '' === trim( $row['title'] ) || ! is_string( $row['slug'] ?? null ) || '' === $row['slug'] ) { return $this->error( 'schema', 'Content requires a kind, title and slug.' ); }
            if ( ! self::same_slug( sanitize_title( $row['slug'] ), $row['slug'] ) ) { return $this->error( 'slug', 'WordPress would change slug ' . $row['slug'] . '.' ); }
            if ( ! in_array( $row['status'] ?? '', array( 'draft', 'pending', 'publish', 'private', 'future' ), true ) ) { return $this->error( 'status', 'Invalid sample publication status.' ); }
            if ( ! empty( $row['publishAt'] ) && ( ! preg_match( '/T.*(?:Z|[+-]\d\d:\d\d)$/D', $row['publishAt'] ) || false === strtotime( $row['publishAt'] ) ) ) { return $this->error( 'date', 'Sample dates must include an explicit timezone.' ); }
            if ( 'future' === $row['status'] && empty( $row['publishAt'] ) ) { return $this->error( 'date', 'Scheduled content requires a date.' ); }
            if ( 'product' === $row['kind'] && ! class_exists( 'WC_Product_Simple' ) ) { return $this->error( 'woocommerce_missing', 'Sample products require active WooCommerce.' ); }
            if ( 'product' === $row['kind'] && ! in_array( $row['productType'] ?? '', array( 'simple', 'variable', 'grouped', 'external' ), true ) ) { return $this->error( 'product_type', 'Unsupported sample product type.' ); }
        }
        $ordered = $this->ordered_terms();
        return is_wp_error( $ordered ) ? $ordered : true;
    }

    private function asset_file( array $row ) {
        if ( ! preg_match( '#^sample-assets/asset-[a-z0-9-]+\.(?:png|jpg|gif|webp|pdf|txt)$#D', $row['file'] ?? '' ) ) { return $this->error( 'asset_path', 'Unsafe sample asset path.' ); }
        $base = realpath( $this->root );
        $file = realpath( $this->root . '/' . $row['file'] );
        if ( ! $base || ! $file || ! is_file( $file ) || 0 !== strpos( $file, $base . DIRECTORY_SEPARATOR ) ) { return $this->error( 'asset_path', 'Sample asset is missing or escapes the payload root.' ); }
        return $file;
    }

    /** Find only records owned by this logical identity, across all statuses. */
    public function owned_post( $id, $type ) {
        $ids = get_posts( array( 'post_type' => $type, 'post_status' => array_keys( get_post_stati() ), 'meta_key' => self::OWNERSHIP_META, 'meta_value' => $id, 'fields' => 'ids', 'numberposts' => 2, 'suppress_filters' => true ) );
        if ( count( $ids ) > 1 ) { return $this->error( 'duplicate_owner', 'More than one destination record owns sample identity ' . $id . '.' ); }
        return $ids ? (int) $ids[0] : 0;
    }

    private function attachment_id( $logical_id ) {
        if ( ! $logical_id ) { return 0; }
        $id = $this->owned_post( $logical_id, 'attachment' );
        if ( is_wp_error( $id ) ) { return $id; }
        return $id ?: $this->error( 'media_reference', 'Sample image has not been installed: ' . $logical_id );
    }

    private function content_html( $html ) {
        $error = null;
        $result = preg_replace_callback( '/\{\{sample-asset:([a-z0-9-]+)\}\}/', function ( $match ) use ( &$error ) {
            $id = $this->attachment_id( $match[1] );
            if ( is_wp_error( $id ) ) { $error = $id; return ''; }
            $url = wp_get_attachment_url( $id );
            if ( ! $url ) { $error = $this->error( 'media_reference', 'Sample attachment URL is unavailable.' ); return ''; }
            return esc_url( $url );
        }, (string) $html );
        return $error ?: wp_kses_post( $result );
    }

    public function install_post( array $row ) {
        $id = $this->owned_post( $row['id'], 'post' );
        if ( is_wp_error( $id ) ) { return $id; }
        $conflict = get_page_by_path( $row['slug'], OBJECT, 'post' );
        if ( $conflict && (int) $conflict->ID !== $id ) { return $this->error( 'slug_conflict', 'An unrelated post already uses slug ' . $row['slug'] . '.' ); }
        $content = $this->content_html( $row['content'] ?? '' );
        if ( is_wp_error( $content ) ) { return $content; }
        $excerpt = $this->content_html( $row['excerpt'] ?? '' );
        if ( is_wp_error( $excerpt ) ) { return $excerpt; }
        $image = $this->attachment_id( $row['featuredImageId'] ?? '' );
        if ( is_wp_error( $image ) ) { return $image; }
        $categories = $this->resolve_term_ids( $row['categoryIds'] ?? array(), 'category' );
        if ( is_wp_error( $categories ) ) { return $categories; }
        $tags = $this->resolve_term_ids( $row['tagIds'] ?? array(), 'post_tag' );
        if ( is_wp_error( $tags ) ) { return $tags; }
        $format = $row['format'] ?? 'standard';
        if ( 'standard' !== $format && ! current_theme_supports( 'post-formats', $format ) ) { return $this->error( 'post_format', 'The destination theme does not support post format ' . $format . '.' ); }
        // Metadata is part of insertion, not a later checkpoint, so a retry
        // after insertion can recover the draft by logical ownership identity.
        $fields = array( 'post_type' => 'post', 'post_status' => 'draft', 'post_title' => sanitize_text_field( $row['title'] ), 'post_name' => sanitize_title( $row['slug'] ), 'post_content' => $content, 'post_excerpt' => $excerpt, 'post_author' => get_current_user_id(), 'comment_status' => $row['commentStatus'] ?? 'closed', 'ping_status' => $row['pingStatus'] ?? 'closed', 'meta_input' => array( self::OWNERSHIP_META => $row['id'] ) );
        if ( $id ) { $fields['ID'] = $id; }
        $saved = wp_insert_post( wp_slash( $fields ), true );
        if ( is_wp_error( $saved ) ) { return $saved; }
        if ( ! $saved ) { return $this->error( 'post_save', 'Could not save sample post.' ); }
        foreach ( array( 'category' => $categories, 'post_tag' => $tags ) as $taxonomy => $ids ) {
            $assigned = wp_set_object_terms( $saved, $ids, $taxonomy, false );
            if ( is_wp_error( $assigned ) ) { return $assigned; }
        }
        if ( $image ) { set_post_thumbnail( $saved, $image ); } else { delete_post_thumbnail( $saved ); }
        set_post_format( $saved, 'standard' === $format ? false : $format );
        if ( ! empty( $row['sticky'] ) ) { stick_post( $saved ); } else { unstick_post( $saved ); }
        return (int) $saved;
    }

    /** Final statuses are applied only after relationships and fields succeed. */
    public function publish_row( array $row ) {
        $id = $this->owned_post( $row['id'], $row['kind'] );
        if ( is_wp_error( $id ) ) { return $id; }
        if ( ! $id ) { return $this->error( 'missing_post', 'Cannot publish missing sample ' . $row['id'] ); }
        $fields = array( 'ID' => $id, 'post_status' => $row['status'] );
        if ( ! empty( $row['publishAt'] ) ) {
            $fields['post_date_gmt'] = gmdate( 'Y-m-d H:i:s', strtotime( $row['publishAt'] ) );
            $fields['post_date'] = get_date_from_gmt( $fields['post_date_gmt'] );
        }
        $result = wp_update_post( $fields, true );
        if ( is_wp_error( $result ) ) { return $result; }
        $saved = get_post( $id );
        if ( ! $saved || ! self::same_slug( $saved->post_name, $row['slug'] ) ) { return $this->error( 'slug_changed', 'WordPress changed the slug of sample ' . $row['title'] . '.' ); }
        $expected = 'future' === $row['status'] && strtotime( $row['publishAt'] ) <= time() ? 'publish' : $row['status'];
        if ( $saved->post_status !== $expected ) { return $this->error( 'status_changed', 'WordPress did not persist the requested status for ' . $row['title'] . '.' ); }
        return (int) $id;
    }

    /** Resolve a declared logical term, never a destination database id. */
    private function term_row( $logical_id ) {
        foreach ( $this->payload['terms'] as $row ) {
            if ( $row['id'] === $logical_id ) { return $row; }
        }
        return null;
    }

    /** WordPress stores Unicode slugs URL-encoded. Compare their decoded values. */
    public static function same_slug( $actual, $requested ) {
        return rawurldecode( (string) $actual ) === rawurldecode( (string) $requested );
    }

    /** Parent-first ordering independent of library insertion order. */
    public function ordered_terms() {
        $pending = array_values( $this->payload['terms'] );
        $ordered = array();
        $done = array();
        while ( count( $pending ) ) {
            $next = array();
            foreach ( $pending as $row ) {
                if ( empty( $row['parentId'] ) || isset( $done[ $row['parentId'] ] ) ) {
                    $ordered[] = $row;
                    $done[ $row['id'] ] = true;
                } else {
                    $next[] = $row;
                }
            }
            if ( count( $next ) === count( $pending ) ) {
                return $this->error( 'term_hierarchy', 'Term hierarchy contains a cycle or a missing parent.' );
            }
            $pending = $next;
        }
        return $ordered;
    }

    /**
     * Persist global attributes through WooCommerce, not register_taxonomy alone.
     * The caller advances to terms on a subsequent WordPress request so WC has
     * registered the newly created pa_* taxonomies normally.
     */
    public function install_attribute( array $row ) {
        if ( ! function_exists( 'wc_create_attribute' ) || ! function_exists( 'wc_get_attribute_taxonomies' ) ) {
            return $this->error( 'woocommerce_missing', 'Global attributes require active WooCommerce.' );
        }
        foreach ( wc_get_attribute_taxonomies() as $existing ) {
            if ( $existing->attribute_name !== $row['slug'] ) { continue; }
            if ( $existing->attribute_label !== $row['name'] || $existing->attribute_type !== $row['type'] || $existing->attribute_orderby !== $row['orderBy'] || (bool) $existing->attribute_public !== (bool) $row['hasArchives'] ) {
                return $this->error( 'attribute_conflict', 'Existing global attribute ' . $row['slug'] . ' has different settings.' );
            }
            return (int) $existing->attribute_id;
        }
        $result = wc_create_attribute( array(
            'name' => $row['name'], 'slug' => $row['slug'], 'type' => $row['type'],
            'order_by' => $row['orderBy'], 'has_archives' => $row['hasArchives'],
        ) );
        if ( is_wp_error( $result ) ) { return $result; }
        $saved = wc_get_attribute( $result );
        if ( ! $saved || ! self::same_slug( $saved->slug, 'pa_' . $row['slug'] ) ) {
            return $this->error( 'attribute_slug', 'WooCommerce normalized attribute ' . $row['slug'] . ' unexpectedly.' );
        }
        return (int) $result;
    }

    /** Create/reuse an exact taxonomy+slug+parent identity without overwrites. */
    public function install_term( array $row ) {
        $taxonomy = $row['taxonomy'];
        if ( ! taxonomy_exists( $taxonomy ) ) {
            return $this->error( 'taxonomy_missing', 'Required taxonomy ' . $taxonomy . ' is not available. Check the selected WooCommerce version and enabled core features.' );
        }
        $parent_id = 0;
        if ( ! empty( $row['parentId'] ) ) {
            $parent_row = $this->term_row( $row['parentId'] );
            if ( ! $parent_row || $parent_row['taxonomy'] !== $taxonomy ) {
                return $this->error( 'term_parent', 'Parent of ' . $row['slug'] . ' must exist in ' . $taxonomy . '.' );
            }
            $parent = get_term_by( 'slug', $parent_row['slug'], $taxonomy );
            if ( ! $parent ) { return $this->error( 'term_parent', 'Parent ' . $parent_row['slug'] . ' has not been installed.' ); }
            $parent_id = (int) $parent->term_id;
        }
        $existing = get_term_by( 'slug', $row['slug'], $taxonomy );
        if ( $existing ) {
            if ( (int) $existing->parent !== $parent_id || ! self::same_slug( $existing->slug, $row['slug'] ) ) {
                return $this->error( 'term_conflict', 'Existing ' . $taxonomy . ' term ' . $row['slug'] . ' has a different hierarchy or normalized slug.' );
            }
            // Existing term names/descriptions/images are destination-owned.
            if ( $existing->name !== $row['name'] || $existing->description !== $row['description'] ) {
                $warnings = (array) get_option( 'mms_wp_starter_sample_warnings', array() );
                $warnings[ $row['id'] ] = 'Reused ' . $taxonomy . ':' . $row['slug'] . ' without overwriting its existing name/description.';
                update_option( 'mms_wp_starter_sample_warnings', $warnings, false );
            }
            return (int) $existing->term_id;
        }
        $created = wp_insert_term( $row['name'], $taxonomy, array( 'slug' => $row['slug'], 'description' => wp_kses_post( $row['description'] ), 'parent' => $parent_id ) );
        if ( is_wp_error( $created ) ) { return $created; }
        $term = get_term( (int) $created['term_id'], $taxonomy );
        if ( is_wp_error( $term ) ) { return $term; }
        if ( ! $term || ! self::same_slug( $term->slug, $row['slug'] ) || (int) $term->parent !== $parent_id ) {
            return $this->error( 'term_slug', 'WordPress changed slug or hierarchy for ' . $taxonomy . ':' . $row['slug'] . '.' );
        }
        update_term_meta( $term->term_id, self::OWNERSHIP_META, $row['id'] );
        return (int) $term->term_id;
    }

    public function resolve_term_ids( array $ids, $taxonomy ) {
        $result = array();
        foreach ( $ids as $logical_id ) {
            $row = $this->term_row( $logical_id );
            if ( ! $row || $row['taxonomy'] !== $taxonomy ) { return $this->error( 'term_reference', 'Invalid logical term ' . $logical_id . ' for ' . $taxonomy . '.' ); }
            $term = get_term_by( 'slug', $row['slug'], $taxonomy );
            if ( ! $term || ! self::same_slug( $term->slug, $row['slug'] ) ) { return $this->error( 'term_reference', 'Term ' . $row['slug'] . ' has not been installed correctly.' ); }
            // Numeric IDs prevent wp_set_object_terms from creating terms with
            // a slug string as their display name or losing hierarchy identity.
            $result[] = (int) $term->term_id;
        }
        return $result;
    }
}
