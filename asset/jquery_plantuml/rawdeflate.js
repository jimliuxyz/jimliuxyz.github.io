/*
 * $Id: rawdeflate.js,v 0.3 2009/03/01 19:05:05 dankogai Exp dankogai $
 *
 * Original:
 *   http://www.onicos.com/staff/iz/amuse/javascript/expert/deflate.txt
 */

// if run as a web worker, respond to messages by deflating them
var deflate = (function() {

/* Copyright (C) 1999 Masanao Izumo <iz@onicos.co.jp>
 * Version: 1.0.1
 * LastModified: Dec 25 1999
 */

/* Interface:
 * data = deflate(src);
 */

/* constant parameters */
var zip_WSIZE = 32768;		// Sliding Window size
var zip_STORED_BLOCK = 0;
var zip_STATIC_TREES = 1;
var zip_DYN_TREES    = 2;

/* for deflate */
var zip_DEFAULT_LEVEL = 6;
var zip_FULL_SEARCH = true;
var zip_INBUFSIZ = 32768;	// Input buffer size
var zip_INBUF_EXTRA = 64;	// Extra buffer
var zip_OUTBUFSIZ = 1024 * 8;
var zip_window_size = 2 * zip_WSIZE;
var zip_MIN_MATCH = 3;
var zip_MAX_MATCH = 258;
var zip_BITS = 16;
// for SMALL_MEM
var zip_LIT_BUFSIZE = 0x2000;
var zip_HASH_BITS = 13;
// for MEDIUM_MEM
// var zip_LIT_BUFSIZE = 0x4000;
// var zip_HASH_BITS = 14;
// for BIG_MEM
// var zip_LIT_BUFSIZE = 0x8000;
// var zip_HASH_BITS = 15;
//if(zip_LIT_BUFSIZE > zip_INBUFSIZ)
//    alert("error: zip_INBUFSIZ is too small");
//if((zip_WSIZE<<1)> (1<<zip_bits)) alert("error:="" zip_wsize="" is="" too="" large");="" if(zip_hash_bits=""> zip_BITS-1)
//    alert("error: zip_HASH_BITS is too large");
//if(zip_HASH_BITS < 8 || zip_MAX_MATCH != 258)
//    alert("error: Code too clever");
var zip_DIST_BUFSIZE = zip_LIT_BUFSIZE;
var zip_HASH_SIZE = 1 << zip_HASH_BITS;
var zip_HASH_MASK = zip_HASH_SIZE - 1;
var zip_WMASK = zip_WSIZE - 1;
var zip_NIL = 0; // Tail of hash chains
var zip_TOO_FAR = 4096;
var zip_MIN_LOOKAHEAD = zip_MAX_MATCH + zip_MIN_MATCH + 1;
var zip_MAX_DIST = zip_WSIZE - zip_MIN_LOOKAHEAD;
var zip_SMALLEST = 1;
var zip_MAX_BITS = 15;
var zip_MAX_BL_BITS = 7;
var zip_LENGTH_CODES = 29;
var zip_LITERALS =256;
var zip_END_BLOCK = 256;
var zip_L_CODES = zip_LITERALS + 1 + zip_LENGTH_CODES;
var zip_D_CODES = 30;
var zip_BL_CODES = 19;
var zip_REP_3_6 = 16;
var zip_REPZ_3_10 = 17;
var zip_REPZ_11_138 = 18;
var zip_HEAP_SIZE = 2 * zip_L_CODES + 1;
var zip_H_SHIFT = parseInt((zip_HASH_BITS + zip_MIN_MATCH - 1) /
			   zip_MIN_MATCH);

/* variables */
var zip_free_queue;
var zip_qhead, zip_qtail;
var zip_initflag;
var zip_outbuf = null;
var zip_outcnt, zip_outoff;
var zip_complete;
var zip_window;
var zip_d_buf;
var zip_l_buf;
var zip_prev;
var zip_bi_buf;
var zip_bi_valid;
var zip_block_start;
var zip_ins_h;
var zip_hash_head;
var zip_prev_match;
var zip_match_available;
var zip_match_length;
var zip_prev_length;
var zip_strstart;
var zip_match_start;
var zip_eofile;
var zip_lookahead;
var zip_max_chain_length;
var zip_max_lazy_match;
var zip_compr_level;
var zip_good_match;
var zip_nice_match;
var zip_dyn_ltree;
var zip_dyn_dtree;
var zip_static_ltree;
var zip_static_dtree;
var zip_bl_tree;
var zip_l_desc;
var zip_d_desc;
var zip_bl_desc;
var zip_bl_count;
var zip_heap;
var zip_heap_len;
var zip_heap_max;
var zip_depth;
var zip_length_code;
var zip_dist_code;
var zip_base_length;
var zip_base_dist;
var zip_flag_buf;
var zip_last_lit;
var zip_last_dist;
var zip_last_flags;
var zip_flags;
var zip_flag_bit;
var zip_opt_len;
var zip_static_len;
var zip_deflate_data;
var zip_deflate_pos;

/* objects (deflate) */

function zip_DeflateCT() {
    this.fc = 0; // frequency count or bit string
    this.dl = 0; // father node in Huffman tree or length of bit string
}

function zip_DeflateTreeDesc() {
    this.dyn_tree = null;	// the dynamic tree
    this.static_tree = null;	// corresponding static tree or NULL
    this.extra_bits = null;	// extra bits for each code or NULL
    this.extra_base = 0;	// base index for extra_bits
    this.elems = 0;		// max number of elements in the tree
    this.max_length = 0;	// max bit length for the codes
    this.max_code = 0;		// largest code with non zero frequency
}

/* Values for max_lazy_match, good_match and max_chain_length, depending on
 * the desired pack level (0..9). The values given below have been tuned to
 * exclude worst case performance for pathological files. Better values may be
 * found for specific files.
 */
function zip_DeflateConfiguration(a, b, c, d) {
    this.good_length = a; // reduce lazy search above this match length
    this.max_lazy = b;    // do not perform lazy search above this match length
    this.nice_length = c; // quit search above this match length
    this.max_chain = d;
}

function zip_DeflateBuffer() {
    this.next = null;
    this.len = 0;
    this.ptr = new Array(zip_OUTBUFSIZ);
    this.off = 0;
}

/* constant tables */
var zip_extra_lbits = [
    0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
var zip_extra_dbits = [
    0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
var zip_extra_blbits = [
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7];
var zip_bl_order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
var zip_configuration_table = [
	new zip_DeflateConfiguration(0,    0,   0,    0),
	new zip_DeflateConfiguration(4,    4,   8,    4),
	new zip_DeflateConfiguration(4,    5,  16,    8),
	new zip_DeflateConfiguration(4,    6,  32,   32),
	new zip_DeflateConfiguration(4,    4,  16,   16),
	new zip_DeflateConfiguration(8,   16,  32,   32),
	new zip_DeflateConfiguration(8,   16, 128,  128),
	new zip_DeflateConfiguration(8,   32, 128,  256),
	new zip_DeflateConfiguration(32, 128, 258, 1024),
	new zip_DeflateConfiguration(32, 258, 258, 4096)];


/* routines (deflate) */

function zip_deflate_start(level) {
    var i;

    if(!level)
	level = zip_DEFAULT_LEVEL;
    else if(level < 1)
	level = 1;
    else if(level > 9)
	level = 9;

    zip_compr_level = level;
    zip_initflag = false;
    zip_eofile = false;
    if(zip_outbuf != null)
	return;

    zip_free_queue = zip_qhead = zip_qtail = null;
    zip_outbuf = new Array(zip_OUTBUFSIZ);
    zip_window = new Array(zip_window_size);
    zip_d_buf = new Array(zip_DIST_BUFSIZE);
    zip_l_buf = new Array(zip_INBUFSIZ + zip_INBUF_EXTRA);
    zip_prev = new Array(1 << zip_BITS);
    zip_dyn_ltree = new Array(zip_HEAP_SIZE);
    for(i = 0; i < zip_HEAP_SIZE; i++)
	zip_dyn_ltree[i] = new zip_DeflateCT();
    zip_dyn_dtree = new Array(2*zip_D_CODES+1);
    for(i = 0; i < 2*zip_D_CODES+1; i++)
	zip_dyn_dtree[i] = new zip_DeflateCT();
    zip_static_ltree = new Array(zip_L_CODES+2);
    for(i = 0; i < zip_L_CODES+2; i++)
	zip_static_ltree[i] = new zip_DeflateCT();
    zip_static_dtree = new Array(zip_D_CODES);
    for(i = 0; i < zip_D_CODES; i++)
	zip_static_dtree[i] = new zip_DeflateCT();
    zip_bl_tree = new Array(2*zip_BL_CODES+1);
    for(i = 0; i < 2*zip_BL_CODES+1; i++)
	zip_bl_tree[i] = new zip_DeflateCT();
    zip_l_desc = new zip_DeflateTreeDesc();
    zip_d_desc = new zip_DeflateTreeDesc();
    zip_bl_desc = new zip_DeflateTreeDesc();
    zip_bl_count = new Array(zip_MAX_BITS+1);
    zip_heap = new Array(2*zip_L_CODES+1);
    zip_depth = new Array(2*zip_L_CODES+1);
    zip_length_code = new Array(zip_MAX_MATCH-zip_MIN_MATCH+1);
    zip_dist_code = new Array(512);
    zip_base_length = new Array(zip_LENGTH_CODES);
    zip_base_dist = new Array(zip_D_CODES);
    zip_flag_buf = new Array(parseInt(zip_LIT_BUFSIZE / 8));
}

function zip_deflate_end() {
    zip_free_queue = zip_qhead = zip_qtail = null;
    zip_outbuf = null;
    zip_window = null;
    zip_d_buf = null;
    zip_l_buf = null;
    zip_prev = null;
    zip_dyn_ltree = null;
    zip_dyn_dtree = null;
    zip_static_ltree = null;
    zip_static_dtree = null;
    zip_bl_tree = null;
    zip_l_desc = null;
    zip_d_desc = null;
    zip_bl_desc = null;
    zip_bl_count = null;
    zip_heap = null;
    zip_depth = null;
    zip_length_code = null;
    zip_dist_code = null;
    zip_base_length = null;
    zip_base_dist = null;
    zip_flag_buf = null;
}

function zip_reuse_queue(p) {
    p.next = zip_free_queue;
    zip_free_queue = p;
}

function zip_new_queue() {
    var p;

    if(zip_free_queue != null)
    {
	p = zip_free_queue;
	zip_free_queue = zip_free_queue.next;
    }
    else
	p = new zip_DeflateBuffer();
    p.next = null;
    p.len = p.off = 0;

    return p;
}

function zip_head1(i) {
    return zip_prev[zip_WSIZE + i];
}

function zip_head2(i, val) {
    return zip_prev[zip_WSIZE + i] = val;
}

/* put_byte is used for the compressed output, put_ubyte for the
 * uncompressed output. However unlzw() uses window for its
 * suffix table instead of its output buffer, so it does not use put_ubyte
 * (to be cleaned up).
 */
function zip_put_byte(c) {
    zip_outbuf[zip_outoff + zip_outcnt++] = c;
    if(zip_outoff + zip_outcnt == zip_OUTBUFSIZ)
	zip_qoutbuf();
}

/* Output a 16 bit value, lsb first */
function zip_put_short(w) {
    w &= 0xffff;
    if(zip_outoff + zip_outcnt < zip_OUTBUFSIZ - 2) {
	zip_outbuf[zip_outoff + zip_outcnt++] = (w & 0xff);
	zip_outbuf[zip_outoff + zip_outcnt++] = (w >>> 8);
    } else {
	zip_put_byte(w & 0xff);
	zip_put_byte(w >>> 8);
    }
}

/* ==========================================================================
 * Insert string s in the dictionary and set match_head to the previous head
 * of the hash chain (the most recent string with same hash key). Return
 * the previous length of the hash chain.
 * IN  assertion: all calls to to INSERT_STRING are made with consecutive
 *    input characters and the first MIN_MATCH bytes of s are valid
 *    (except for the last MIN_MATCH-1 bytes of the input file).
 */
function zip_INSERT_STRING() {
    zip_ins_h = ((zip_ins_h << zip_H_SHIFT)
		 ^ (zip_window[zip_strstart + zip_MIN_MATCH - 1] & 0xff))
	& zip_HASH_MASK;
    zip_hash_head = zip_head1(zip_ins_h);
    zip_prev[zip_strstart & zip_WMASK] = zip_hash_head;
    zip_head2(zip_ins_h, zip_strstart);
}

/* Send a code of the given tree. c and tree must not have side effects */
function zip_SEND_CODE(c, tree) {
    zip_send_bits(tree[c].fc, tree[c].dl);
}

/* Mapping from a distance to a distance code. dist is the distance - 1 and
 * must not have side effects. dist_code[256] and dist_code[257] are never
 * used.
 */
function zip_D_CODE(dist) {
    return (dist < 256 ? zip_dist_code[dist]
	    : zip_dist_code[256 + (dist>>7)]) & 0xff;
}

/* ==========================================================================
 * Compares to subtrees, using the tree depth as tie breaker when
 * the subtrees have equal frequency. This minimizes the worst case length.
 */
function zip_SMALLER(tree, n, m) {
    return tree[n].fc < tree[m].fc ||
      (tree[n].fc == tree[m].fc && zip_depth[n] <= 2="" zip_depth[m]);="" }="" *="=========================================================================" read="" string="" data="" function="" zip_read_buff(buff,="" offset,="" n)="" {="" var="" i;="" for(i="0;" i="" <="" n="" &&="" zip_deflate_pos="" zip_deflate_data.length;="" i++)="" buff[offset="" +="" i]="zip_deflate_data.charCodeAt(zip_deflate_pos++)" &="" 0xff;="" return="" initialize="" the="" "longest="" match"="" routines="" for="" a="" new="" file="" zip_lm_init()="" j;="" hash="" table.="" for(j="0;" j="" zip_hash_size;="" j++)="" zip_head2(j,="" zip_nil);="" zip_prev[zip_wsize="" j]="0;" prev="" will="" be="" initialized="" on="" fly="" set="" default configuration="" parameters:="" zip_max_lazy_match="zip_configuration_table[zip_compr_level].max_lazy;" zip_good_match="zip_configuration_table[zip_compr_level].good_length;" if(!zip_full_search)="" zip_nice_match="zip_configuration_table[zip_compr_level].nice_length;" zip_max_chain_length="zip_configuration_table[zip_compr_level].max_chain;" zip_strstart="0;" zip_block_start="0;" zip_lookahead="zip_read_buff(zip_window," 0,="" zip_wsize);="" if(zip_lookahead="" zip_eofile="true;" return;="" make="" sure="" that="" we="" always="" have="" enough="" lookahead.="" this="" is="" important="" if="" input="" comes="" from="" device="" such="" as="" tty.="" while(zip_lookahead="" zip_min_lookahead="" !zip_eofile)="" zip_fill_window();="" lookahead="" min_match,="" ins_h="" garbage,="" but="" not="" since="" only="" literal="" bytes="" emitted.="" zip_ins_h="0;" zip_min_match="" -="" 1;="" update_hash(ins_h,="" window[j]);="" <<="" zip_h_shift)="" ^="" (zip_window[j]="" 0xff))="" zip_hash_mask;="" match_start="" to="" longest="" match="" starting="" at="" given="" and="" its="" length.="" matches="" shorter="" or="" equal="" prev_length="" are="" discarded,="" in="" which="" case="" result="" garbage.="" assertions:="" cur_match="" head="" of="" chain="" current="" (strstart)="" distance="">= 1
 */
function zip_longest_match(cur_match) {
    var chain_length = zip_max_chain_length; // max hash chain length
    var scanp = zip_strstart; // current string
    var matchp;		// matched string
    var len;		// length of current match
    var best_len = zip_prev_length;	// best match length so far

    /* Stop when cur_match becomes <= limit.="" to="" simplify="" the="" code,="" *="" we="" prevent="" matches="" with="" string="" of="" window="" index="" 0.="" var="" limit="(zip_strstart"> zip_MAX_DIST ? zip_strstart - zip_MAX_DIST : zip_NIL);

    var strendp = zip_strstart + zip_MAX_MATCH;
    var scan_end1 = zip_window[scanp + best_len - 1];
    var scan_end  = zip_window[scanp + best_len];

    /* Do not waste too much time if we already have a good match: */
    if(zip_prev_length >= zip_good_match)
	chain_length >>= 2;

//  Assert(encoder->strstart <= window_size-min_lookahead,="" "insufficient="" lookahead");="" do="" {="" assert(cur_match="" <="" encoder-="">strstart, "no future");
	matchp = cur_match;

	/* Skip to next match if the match length cannot increase
	    * or if the match length is less than 2:
	*/
	if(zip_window[matchp + best_len]	!= scan_end  ||
	   zip_window[matchp + best_len - 1]	!= scan_end1 ||
	   zip_window[matchp]			!= zip_window[scanp] ||
	   zip_window[++matchp]			!= zip_window[scanp + 1]) {
	    continue;
	}

	/* The check at best_len-1 can be removed because it will be made
         * again later. (This heuristic is not always a win.)
         * It is not necessary to compare scan[2] and match[2] since they
         * are always equal when the other bytes match, given that
         * the hash keys are equal and that HASH_BITS >= 8.
         */
	scanp += 2;
	matchp++;

	/* We check for insufficient lookahead only every 8th comparison;
         * the 256th check will be made at strstart+258.
         */
	do {
	} while(zip_window[++scanp] == zip_window[++matchp] &&
		zip_window[++scanp] == zip_window[++matchp] &&
		zip_window[++scanp] == zip_window[++matchp] &&
		zip_window[++scanp] == zip_window[++matchp] &&
		zip_window[++scanp] == zip_window[++matchp] &&
		zip_window[++scanp] == zip_window[++matchp] &&
		zip_window[++scanp] == zip_window[++matchp] &&
		zip_window[++scanp] == zip_window[++matchp] &&
		scanp < strendp);

      len = zip_MAX_MATCH - (strendp - scanp);
      scanp = strendp - zip_MAX_MATCH;

      if(len > best_len) {
	  zip_match_start = cur_match;
	  best_len = len;
	  if(zip_FULL_SEARCH) {
	      if(len >= zip_MAX_MATCH) break;
	  } else {
	      if(len >= zip_nice_match) break;
	  }

	  scan_end1  = zip_window[scanp + best_len-1];
	  scan_end   = zip_window[scanp + best_len];
      }
    } while((cur_match = zip_prev[cur_match & zip_WMASK]) > limit
	    && --chain_length != 0);

    return best_len;
}

/* ==========================================================================
 * Fill the window when the lookahead becomes insufficient.
 * Updates strstart and lookahead, and sets eofile if end of input file.
 * IN assertion: lookahead < MIN_LOOKAHEAD && strstart + lookahead > 0
 * OUT assertions: at least one byte has been read, or eofile is set;
 *    file reads are performed for at least two bytes (required for the
 *    translate_eol option).
 */
function zip_fill_window() {
    var n, m;

    // Amount of free space at the end of the window.
    var more = zip_window_size - zip_lookahead - zip_strstart;

    /* If the window is almost full and there is insufficient lookahead,
     * move the upper half to the lower one to make room in the upper half.
     */
    if(more == -1) {
	/* Very unlikely, but possible on 16 bit machine if strstart == 0
         * and lookahead == 1 (input done one byte at time)
         */
	more--;
    } else if(zip_strstart >= zip_WSIZE + zip_MAX_DIST) {
	/* By the IN assertion, the window is not empty so we can't confuse
         * more == 0 with more == 64K on a 16 bit machine.
         */
//	Assert(window_size == (ulg)2*WSIZE, "no sliding with BIG_MEM");

//	System.arraycopy(window, WSIZE, window, 0, WSIZE);
	for(n = 0; n < zip_WSIZE; n++)
	    zip_window[n] = zip_window[n + zip_WSIZE];
      
	zip_match_start -= zip_WSIZE;
	zip_strstart    -= zip_WSIZE; /* we now have strstart >= MAX_DIST: */
	zip_block_start -= zip_WSIZE;

	for(n = 0; n < zip_HASH_SIZE; n++) {
	    m = zip_head1(n);
	    zip_head2(n, m >= zip_WSIZE ? m - zip_WSIZE : zip_NIL);
	}
	for(n = 0; n < zip_WSIZE; n++) {
	    /* If n is not on any hash chain, prev[n] is garbage but
	     * its value will never be used.
	     */
	    m = zip_prev[n];
	    zip_prev[n] = (m >= zip_WSIZE ? m - zip_WSIZE : zip_NIL);
	}
	more += zip_WSIZE;
    }
    // At this point, more >= 2
    if(!zip_eofile) {
	n = zip_read_buff(zip_window, zip_strstart + zip_lookahead, more);
	if(n <= 0="" 0)="" zip_eofile="true;" else="" zip_lookahead="" +="n;" }="" *="=========================================================================" processes="" a="" new="" input="" file="" and="" return="" its="" compressed="" length.="" this="" function="" does="" not="" perform="" lazy="" evaluationof="" matches="" inserts="" strings="" in="" the="" dictionary="" only="" for="" unmatched="" or="" short="" matches.="" it="" is="" used="" fast="" compression="" options.="" zip_deflate_fast()="" {="" while(zip_lookahead="" !="0" &&="" zip_qhead="=" null)="" var="" flush;="" set="" if="" current="" block="" must="" be="" flushed="" insert="" string="" window[strstart="" ..="" strstart+2]="" dictionary,="" hash_head="" to="" head="" of="" hash="" chain:="" zip_insert_string();="" find="" longest="" match,="" discarding="" those="" <="prev_length." at="" point="" we="" have="" always="" match_length="" min_match="" if(zip_hash_head="" zip_strstart="" -="" zip_hash_head="" simplify="" code,="" prevent="" with="" window="" index="" (in="" particular="" avoid="" match="" itself="" start="" file).="" zip_match_length="zip_longest_match(zip_hash_head);" longest_match()="" sets="" match_start="" if(zip_match_length=""> zip_lookahead)
		zip_match_length = zip_lookahead;
	}
	if(zip_match_length >= zip_MIN_MATCH) {
//	    check_match(strstart, match_start, match_length);

	    flush = zip_ct_tally(zip_strstart - zip_match_start,
				 zip_match_length - zip_MIN_MATCH);
	    zip_lookahead -= zip_match_length;

	    /* Insert new strings in the hash table only if the match length
	     * is not too large. This saves time but degrades compression.
	     */
	    if(zip_match_length <= 0="" zip_max_lazy_match)="" {="" zip_match_length--;="" string="" at="" strstart="" already="" in="" hash="" table="" do="" zip_strstart++;="" zip_insert_string();="" *="" never="" exceeds="" wsize-max_match,="" so="" there="" are="" always="" min_match="" bytes="" ahead.="" if="" lookahead="" <="" these="" garbage,="" but="" it="" does="" not="" matter="" since="" the="" next="" will="" be="" emitted="" as="" literals.="" }="" while(--zip_match_length="" !="0);" else="" zip_strstart="" +="zip_match_length;" zip_match_length="0;" zip_ins_h="zip_window[zip_strstart]" &="" 0xff;="" update_hash(ins_h,="" window[strstart="" 1]);="" ^="" (zip_window[zip_strstart="" 1]="" 0xff))="" zip_hash_mask;="" #if="" call="" update_hash()="" min_match-3="" more="" times="" #endif="" no="" match,="" output="" a="" literal="" byte="" flush="zip_ct_tally(0," zip_window[zip_strstart]="" 0xff);="" zip_lookahead--;="" if(flush)="" zip_flush_block(0);="" zip_block_start="zip_strstart;" make="" sure="" that="" we="" have="" enough="" lookahead,="" except="" end="" of="" input="" file.="" need="" max_match="" for="" plus="" to="" insert="" following="" match.="" while(zip_lookahead="" zip_min_lookahead="" &&="" !zip_eofile)="" zip_fill_window();="" function="" zip_deflate_better()="" process="" block.="" zip_qhead="=" null)="" ..="" strstart+2]="" dictionary,="" and="" set="" hash_head="" head="" chain:="" find="" longest="" discarding="" those="" zip_prev_length="zip_match_length;" zip_prev_match="zip_match_start;" -="" 1;="" if(zip_hash_head="" zip_max_lazy_match="" zip_hash_head="" simplify="" code,="" prevent="" matches="" with="" window="" index="" (in="" particular="" avoid="" match="" itself="" start="" file).="" longest_match()="" sets="" match_start="" if(zip_match_length=""> zip_lookahead)
		zip_match_length = zip_lookahead;

	    /* Ignore a length 3 match if it is too distant: */
	    if(zip_match_length == zip_MIN_MATCH &&
	       zip_strstart - zip_match_start > zip_TOO_FAR) {
		/* If prev_match is also MIN_MATCH, match_start is garbage
		 * but we will ignore the current match anyway.
		 */
		zip_match_length--;
	    }
	}
	/* If there was a match at the previous step and the current
	 * match is not better, output the previous match:
	 */
	if(zip_prev_length >= zip_MIN_MATCH &&
	   zip_match_length <= 1="" zip_prev_length)="" {="" var="" flush;="" set="" if="" current="" block="" must="" be="" flushed="" check_match(strstart="" -="" 1,="" prev_match,="" prev_length);="" flush="zip_ct_tally(zip_strstart" zip_prev_match,="" zip_prev_length="" zip_min_match);="" *="" insert="" in="" hash="" table="" all="" strings="" up="" to="" the="" end="" of="" match.="" strstart-1="" and="" strstart="" are="" already="" inserted.="" zip_lookahead="" 1;="" do="" zip_strstart++;="" zip_insert_string();="" never="" exceeds="" wsize-max_match,="" so="" there="" always="" min_match="" bytes="" ahead.="" lookahead="" <="" these="" garbage,="" but="" it="" does="" not="" matter="" since="" next="" will="" emitted="" as="" literals.="" }="" while(--zip_prev_length="" !="0);" zip_match_available="0;" zip_match_length="zip_MIN_MATCH" if(flush)="" zip_flush_block(0);="" zip_block_start="zip_strstart;" else="" if(zip_match_available="" was="" no="" match="" at="" previous="" position,="" output="" a="" single="" literal.="" is="" longer,="" truncate="" if(zip_ct_tally(0,="" zip_window[zip_strstart="" 1]="" &="" 0xff))="" zip_lookahead--;="" compare="" with,="" wait="" for="" step="" decide.="" make="" sure="" that="" we="" have="" enough="" lookahead,="" except="" input="" file.="" need="" max_match="" match,="" plus="" string="" following="" while(zip_lookahead="" zip_min_lookahead="" &&="" !zip_eofile)="" zip_fill_window();="" function="" zip_init_deflate()="" if(zip_eofile)="" return;="" zip_bi_buf="0;" zip_bi_valid="0;" zip_ct_init();="" zip_lm_init();="" zip_qhead="null;" zip_outcnt="0;" zip_outoff="0;" if(zip_compr_level="" zip_complete="false;" same="" above,="" achieves="" better="" compression.="" use="" lazy="" evaluation="" matches:="" finally="" adopted="" only="" window="" position.="" zip_deflate_internal(buff,="" off,="" buff_size)="" n;="" if(!zip_initflag)="" zip_init_deflate();="" zip_initflag="true;" if(zip_lookahead="=" 0)="" empty="" return="" 0;="" if((n="zip_qcopy(buff," buff_size))="=" buff_size;="" if(zip_complete)="" optimized="" speed="" zip_deflate_fast();="" zip_deflate_better();="" zip_ct_tally(0,="" 0xff);="" zip_flush_block(1);="" n="" +="" zip_qcopy(buff,="" buff_size="" n);="" n,="" i,="" j;="" while(zip_qhead="" i="buff_size" if(i=""> zip_qhead.len)
	    i = zip_qhead.len;
//      System.arraycopy(qhead.ptr, qhead.off, buff, off + n, i);
	for(j = 0; j < i; j++)
	    buff[off + n + j] = zip_qhead.ptr[zip_qhead.off + j];
	
	zip_qhead.off += i;
	zip_qhead.len -= i;
	n += i;
	if(zip_qhead.len == 0) {
	    var p;
	    p = zip_qhead;
	    zip_qhead = zip_qhead.next;
	    zip_reuse_queue(p);
	}
    }

    if(n == buff_size)
	return n;

    if(zip_outoff < zip_outcnt) {
	i = buff_size - n;
	if(i > zip_outcnt - zip_outoff)
	    i = zip_outcnt - zip_outoff;
	// System.arraycopy(outbuf, outoff, buff, off + n, i);
	for(j = 0; j < i; j++)
	    buff[off + n + j] = zip_outbuf[zip_outoff + j];
	zip_outoff += i;
	n += i;
	if(zip_outcnt == zip_outoff)
	    zip_outcnt = zip_outoff = 0;
    }
    return n;
}

/* ==========================================================================
 * Allocate the match buffer, initialize the various tables and save the
 * location of the internal file attribute (ascii/binary) and method
 * (DEFLATE/STORE).
 */
function zip_ct_init() {
    var n;	// iterates over tree elements
    var bits;	// bit counter
    var length;	// length value
    var code;	// code value
    var dist;	// distance index

    if(zip_static_dtree[0].dl != 0) return; // ct_init already called

    zip_l_desc.dyn_tree		= zip_dyn_ltree;
    zip_l_desc.static_tree	= zip_static_ltree;
    zip_l_desc.extra_bits	= zip_extra_lbits;
    zip_l_desc.extra_base	= zip_LITERALS + 1;
    zip_l_desc.elems		= zip_L_CODES;
    zip_l_desc.max_length	= zip_MAX_BITS;
    zip_l_desc.max_code		= 0;

    zip_d_desc.dyn_tree		= zip_dyn_dtree;
    zip_d_desc.static_tree	= zip_static_dtree;
    zip_d_desc.extra_bits	= zip_extra_dbits;
    zip_d_desc.extra_base	= 0;
    zip_d_desc.elems		= zip_D_CODES;
    zip_d_desc.max_length	= zip_MAX_BITS;
    zip_d_desc.max_code		= 0;

    zip_bl_desc.dyn_tree	= zip_bl_tree;
    zip_bl_desc.static_tree	= null;
    zip_bl_desc.extra_bits	= zip_extra_blbits;
    zip_bl_desc.extra_base	= 0;
    zip_bl_desc.elems		= zip_BL_CODES;
    zip_bl_desc.max_length	= zip_MAX_BL_BITS;
    zip_bl_desc.max_code	= 0;

    // Initialize the mapping length (0..255) -> length code (0..28)
    length = 0;
    for(code = 0; code < zip_LENGTH_CODES-1; code++) {
	zip_base_length[code] = length;
	for(n = 0; n < (1<<zip_extra_lbits[code]); 5="" 255="" 284="" n++)="" zip_length_code[length++]="code;" }="" assert="" (length="=" 256,="" "ct_init:="" length="" !="256");" *="" note="" that="" the="" (match="" 258)="" can="" be="" represented="" in="" two="" different="" ways:="" code="" +="" bits="" or="" 285,="" so="" we="" overwrite="" length_code[255]="" to="" use="" best="" encoding:="" zip_length_code[length-1]="code;" initialize="" mapping="" dist="" (0..32k)="" -=""> dist code (0..29) */
    dist = 0;
    for(code = 0 ; code < 16; code++) {
	zip_base_dist[code] = dist;
	for(n = 0; n < (1<<zip_extra_dbits[code]); n++)="" {="" zip_dist_code[dist++]="code;" }="" assert="" (dist="=" 256,="" "ct_init:="" dist="" !="256");">>= 7; // from now on, all distances are divided by 128
    for( ; code < zip_D_CODES; code++) {
	zip_base_dist[code] = dist << 7;
	for(n = 0; n < (1<<(zip_extra_dbits[code]-7)); 286="" 287="" n++)="" zip_dist_code[256="" +="" dist++]="code;" }="" assert="" (dist="=" 256,="" "ct_init:="" 256+dist="" !="512");" construct="" the="" codes="" of="" static="" literal="" tree="" for(bits="0;" bits="" <="zip_MAX_BITS;" bits++)="" zip_bl_count[bits]="0;" n="0;" while(n="" {="" zip_static_ltree[n++].dl="8;" zip_bl_count[8]++;="" zip_bl_count[9]++;="" zip_bl_count[7]++;="" *="" and="" do="" not="" exist,="" but="" we="" must="" include="" them="" in="" construction="" to="" get="" a="" canonical="" huffman="" (longest="" code="" all="" ones)="" zip_gen_codes(zip_static_ltree,="" zip_l_codes="" 1);="" distance="" is="" trivial:="" for(n="0;" zip_d_codes;="" zip_static_dtree[n].dl="5;" zip_static_dtree[n].fc="zip_bi_reverse(n," 5);="" initialize="" first="" block="" file:="" zip_init_block();="" new="" block.="" function="" zip_init_block()="" var="" n;="" iterates="" over="" elements="" trees.="" zip_l_codes;="" zip_dyn_ltree[n].fc="0;" zip_dyn_dtree[n].fc="0;" zip_bl_codes;="" zip_bl_tree[n].fc="0;" zip_dyn_ltree[zip_end_block].fc="1;" zip_opt_len="zip_static_len" =="" 0;="" zip_last_lit="zip_last_dist" zip_last_flags="0;" zip_flags="0;" zip_flag_bit="1;" restore="" heap="" property="" by="" moving="" down="" starting="" at="" node="" k,="" exchanging="" with="" smallest="" its="" two="" sons="" if="" necessary,="" stopping="" when="" re-established="" (each="" father="" smaller="" than="" sons).="" zip_pqdownheap(="" tree,="" k)="" move="" v="zip_heap[k];" j="k" <<="" 1;="" left="" son="" k="" while(j="" set="" sons:="" if(j="" zip_heap_len="" &&="" zip_smaller(tree,="" zip_heap[j="" 1],="" zip_heap[j]))="" j++;="" exit="" both="" if(zip_smaller(tree,="" v,="" break;="" exchange="" zip_heap[k]="zip_heap[j];" continue="" setting="" compute="" optimal="" bit="" lengths="" for="" update="" total="" length="" current="" assertion:="" fields="" freq="" dad="" are="" set,="" heap[heap_max]="" above="" nodes="" sorted="" increasing="" frequency.="" out="" assertions:="" field="" len="" length,="" array="" bl_count="" contains="" frequencies="" each="" length.="" opt_len="" updated;="" static_len="" also="" updated="" stree="" null.="" zip_gen_bitlen(desc)="" descriptor="" extra="desc.extra_bits;" base="desc.extra_base;" max_code="desc.max_code;" max_length="desc.max_length;" h;="" index="" n,="" m;="" iterate="" bits;="" xbits;="" f;="" frequency="" overflow="0;" number="" too="" large="" pass,="" (which="" may="" case="" tree).="" tree[zip_heap[zip_heap_max]].dl="0;" root="" for(h="zip_heap_max" h="" zip_heap_size;="" h++)="" if(bits=""> max_length) {
	    bits = max_length;
	    overflow++;
	}
	tree[n].dl = bits;
	// We overwrite tree[n].dl which is no longer needed

	if(n > max_code)
	    continue; // not a leaf node

	zip_bl_count[bits]++;
	xbits = 0;
	if(n >= base)
	    xbits = extra[n - base];
	f = tree[n].fc;
	zip_opt_len += f * (bits + xbits);
	if(stree != null)
	    zip_static_len += f * (stree[n].dl + xbits);
    }
    if(overflow == 0)
	return;

    // This happens for example on obj2 and pic of the Calgary corpus

    // Find the first bit length which could increase:
    do {
	bits = max_length - 1;
	while(zip_bl_count[bits] == 0)
	    bits--;
	zip_bl_count[bits]--;		// move one leaf down the tree
	zip_bl_count[bits + 1] += 2;	// move one overflow item as its brother
	zip_bl_count[max_length]--;
	/* The brother of the overflow item also moves one step up,
	 * but this does not affect bl_count[max_length]
	 */
	overflow -= 2;
    } while(overflow > 0);

    /* Now recompute all bit lengths, scanning in increasing frequency.
     * h is still equal to HEAP_SIZE. (It is simpler to reconstruct all
     * lengths instead of fixing only the wrong ones. This idea is taken
     * from 'ar' written by Haruhiko Okumura.)
     */
    for(bits = max_length; bits != 0; bits--) {
	n = zip_bl_count[bits];
	while(n != 0) {
	    m = zip_heap[--h];
	    if(m > max_code)
		continue;
	    if(tree[m].dl != bits) {
		zip_opt_len += (bits - tree[m].dl) * tree[m].fc;
		tree[m].fc = bits;
	    }
	    n--;
	}
    }
}

  /* ==========================================================================
   * Generate the codes for a given tree and bit counts (which need not be
   * optimal).
   * IN assertion: the array bl_count contains the bit length statistics for
   * the given tree and the field len is set for all tree elements.
   * OUT assertion: the field code is set for all tree elements of non
   *     zero code length.
   */
function zip_gen_codes(tree,	// the tree to decorate
		   max_code) {	// largest code with non zero frequency
    var next_code = new Array(zip_MAX_BITS+1); // next code value for each bit length
    var code = 0;		// running code value
    var bits;			// bit index
    var n;			// code index

    /* The distribution counts are first used to generate the code values
     * without bit reversal.
     */
    for(bits = 1; bits <= zip_max_bits;="" bits++)="" {="" code="((code" +="" zip_bl_count[bits-1])="" <<="" 1);="" next_code[bits]="code;" }="" *="" check="" that="" the="" bit="" counts="" in="" bl_count="" are="" consistent.="" last="" must="" be="" all="" ones.="" assert="" (code="" encoder-="">bl_count[MAX_BITS]-1 == (1<<max_bits)-1, 0="" 1="" 2="" "inconsistent="" bit="" counts");="" tracev((stderr,"\ngen_codes:="" max_code="" %d="" ",="" max_code));="" for(n="0;" n="" <="max_code;" n++)="" {="" var="" len="tree[n].dl;" if(len="=" 0)="" continue;="" now="" reverse="" the="" bits="" tree[n].fc="zip_bi_reverse(next_code[len]++," len);="" tracec(tree="" !="static_ltree," (stderr,"\nn="" %3d="" %c="" l="" %2d="" c="" %4x="" (%x)="" n,="" (isgraph(n)="" ?="" :="" '="" '),="" len,="" tree[n].fc,="" next_code[len]-1));="" }="" *="=========================================================================" construct="" one="" huffman="" tree="" and="" assigns="" code="" strings="" lengths.="" update="" total="" length="" for="" current="" block.="" in="" assertion:="" field="" freq="" is="" set="" all="" elements.="" out="" assertions:="" fields="" are="" to="" optimal="" corresponding="" code.="" opt_len="" updated;="" static_len="" also="" updated="" if="" stree="" not="" null.="" set.="" function="" zip_build_tree(desc)="" descriptor="" elems="desc.elems;" m;="" iterate="" over="" heap="" elements="" largest="" with="" non="" zero="" frequency="" node="elems;" next="" internal="" of="" initial="" heap,="" least="" frequent="" element="" heap[smallest].="" sons="" heap[n]="" heap[2*n]="" heap[2*n+1].="" heap[0]="" used.="" zip_heap_len="0;" zip_heap_max="zip_HEAP_SIZE;" elems;="" if(tree[n].fc="" zip_heap[++zip_heap_len]="max_code" =="" n;="" zip_depth[n]="0;" else="" tree[n].dl="0;" pkzip="" format="" requires="" that="" at="" distance="" exists,="" should="" be="" sent="" even="" there="" only="" possible="" so="" avoid="" special="" checks="" later="" on="" we="" force="" two="" codes="" frequency.="" while(zip_heap_len="" 2)="" xnew="zip_heap[++zip_heap_len]" (max_code="" ++max_code="" 0);="" tree[xnew].fc="1;" zip_depth[xnew]="0;" zip_opt_len--;="" if(stree="" zip_static_len="" -="stree[xnew].dl;" new="" or="" it="" does="" have="" extra="" desc.max_code="max_code;" heap[heap_len="" 2+1="" ..="" heap_len]="" leaves="" tree,="" establish="" sub-heaps="" increasing="" lengths:="">> 1; n >= 1; n--)
	zip_pqdownheap(tree, n);

    /* Construct the Huffman tree by repeatedly combining the least two
     * frequent nodes.
     */
    do {
	n = zip_heap[zip_SMALLEST];
	zip_heap[zip_SMALLEST] = zip_heap[zip_heap_len--];
	zip_pqdownheap(tree, zip_SMALLEST);

	m = zip_heap[zip_SMALLEST];  // m = node of next least frequency

	// keep the nodes sorted by frequency
	zip_heap[--zip_heap_max] = n;
	zip_heap[--zip_heap_max] = m;

	// Create a new node father of n and m
	tree[node].fc = tree[n].fc + tree[m].fc;
//	depth[node] = (char)(MAX(depth[n], depth[m]) + 1);
	if(zip_depth[n] > zip_depth[m] + 1)
	    zip_depth[node] = zip_depth[n];
	else
	    zip_depth[node] = zip_depth[m] + 1;
	tree[n].dl = tree[m].dl = node;

	// and insert the new node in the heap
	zip_heap[zip_SMALLEST] = node++;
	zip_pqdownheap(tree, zip_SMALLEST);

    } while(zip_heap_len >= 2);

    zip_heap[--zip_heap_max] = zip_heap[zip_SMALLEST];

    /* At this point, the fields freq and dad are set. We can now
     * generate the bit lengths.
     */
    zip_gen_bitlen(desc);

    // The field len is now set, we can generate the bit codes
    zip_gen_codes(tree, max_code);
}

/* ==========================================================================
 * Scan a literal or distance tree to determine the frequencies of the codes
 * in the bit length tree. Updates opt_len to take into account the repeat
 * counts. (The contribution of the bit length codes will be added later
 * during the construction of bl_tree.)
 */
function zip_scan_tree(tree,// the tree to be scanned
		       max_code) {  // and its largest code of non zero frequency
    var n;			// iterates over all tree elements
    var prevlen = -1;		// last emitted length
    var curlen;			// length of current code
    var nextlen = tree[0].dl;	// length of next code
    var count = 0;		// repeat count of the current code
    var max_count = 7;		// max repeat count
    var min_count = 4;		// min repeat count

    if(nextlen == 0) {
	max_count = 138;
	min_count = 3;
    }
    tree[max_code + 1].dl = 0xffff; // guard

    for(n = 0; n <= max_code;="" n++)="" {="" curlen="nextlen;" nextlen="tree[n" +="" 1].dl;="" if(++count="" <="" max_count="" &&="" nextlen)="" continue;="" else="" if(count="" min_count)="" zip_bl_tree[curlen].fc="" if(curlen="" !="0)" zip_bl_tree[curlen].fc++;="" zip_bl_tree[zip_rep_3_6].fc++;="" }="" zip_bl_tree[zip_repz_3_10].fc++;="" zip_bl_tree[zip_repz_11_138].fc++;="" count="0;" prevlen="curlen;" if(nextlen="=" 0)="" min_count="3;" *="=========================================================================" send="" a="" literal="" or="" distance="" tree="" in="" compressed="" form,="" using="" the="" codes="" bl_tree.="" function="" zip_send_tree(tree,="" to="" be="" scanned="" max_code)="" and="" its="" largest="" code="" of="" non="" zero="" frequency="" var="" n;="" iterates="" over="" all="" elements="" last="" emitted="" length="" curlen;="" current="" next="" repeat="" max="" min="" tree[max_code+1].dl="-1;" guard="" already="" set="" for(n="0;" n="" do="" zip_send_code(curlen,="" zip_bl_tree);="" while(--count="" count--;="" assert(count="">= 3 && count <= 3="" 4="" 6,="" "="" 3_6?");="" zip_send_code(zip_rep_3_6,="" zip_bl_tree);="" zip_send_bits(count="" -="" 3,="" 2);="" }="" else="" if(count="" <="10)" {="" zip_send_code(zip_repz_3_10,="" zip_send_bits(count-3,="" 3);="" zip_send_code(zip_repz_11_138,="" zip_send_bits(count-11,="" 7);="" count="0;" prevlen="curlen;" if(nextlen="=" 0)="" max_count="138;" min_count="3;" if(curlen="=" nextlen)="" *="=========================================================================" construct="" the="" huffman="" tree="" for="" bit="" lengths="" and="" return="" index="" in="" bl_order="" of="" last="" length="" code="" to="" send.="" function="" zip_build_bl_tree()="" var="" max_blindex;="" non="" zero="" freq="" determine="" frequencies="" literal="" distance="" trees="" zip_scan_tree(zip_dyn_ltree,="" zip_l_desc.max_code);="" zip_scan_tree(zip_dyn_dtree,="" zip_d_desc.max_code);="" build="" tree:="" zip_build_tree(zip_bl_desc);="" opt_len="" now="" includes="" representations,="" except="" codes="" 5+5+4="" bits="" counts.="" number="" pkzip="" format="" requires="" that="" at="" least="" be="" sent.="" (appnote.txt="" says="" but="" actual="" value="" used="" is="" 4.)="" for(max_blindex="zip_BL_CODES-1;" max_blindex="">= 3; max_blindex--) {
	if(zip_bl_tree[zip_bl_order[max_blindex]].dl != 0) break;
    }
    /* Update opt_len to include the bit length tree and counts */
    zip_opt_len += 3*(max_blindex+1) + 5+5+4;
//    Tracev((stderr, "\ndyn trees: dyn %ld, stat %ld",
//	    encoder->opt_len, encoder->static_len));

    return max_blindex;
}

/* ==========================================================================
 * Send the header for a block using dynamic Huffman trees: the counts, the
 * lengths of the bit length codes, the literal tree and the distance tree.
 * IN assertion: lcodes >= 257, dcodes >= 1, blcodes >= 4.
 */
function zip_send_all_trees(lcodes, dcodes, blcodes) { // number of codes for each tree
    var rank; // index in bl_order

//    Assert (lcodes >= 257 && dcodes >= 1 && blcodes >= 4, "not enough codes");
//    Assert (lcodes <= 8="" l_codes="" &&="" dcodes="" <="D_CODES" blcodes="" "too="" many="" codes");="" tracev((stderr,="" "\nbl="" counts:="" "));="" zip_send_bits(lcodes-257,="" 5);="" not="" +255="" as="" stated="" in="" appnote.txt="" zip_send_bits(dcodes-1,="" zip_send_bits(blcodes-4,="" 4);="" -3="" for(rank="0;" rank="" blcodes;="" rank++)="" {="" code="" %2d="" ",="" bl_order[rank]));="" zip_send_bits(zip_bl_tree[zip_bl_order[rank]].dl,="" 3);="" }="" send="" the="" literal="" tree="" zip_send_tree(zip_dyn_ltree,lcodes-1);="" distance="" zip_send_tree(zip_dyn_dtree,dcodes-1);="" *="=========================================================================" determine="" best="" encoding="" for="" current="" block:="" dynamic="" trees,="" static="" trees="" or="" store,="" and="" output="" encoded="" block="" to="" zip="" file.="" function="" zip_flush_block(eof)="" true="" if="" this="" is="" last="" a="" file="" var="" opt_lenb,="" static_lenb;="" opt_len="" static_len="" bytes="" max_blindex;="" index="" of="" bit="" length="" non="" zero="" freq="" stored_len;="" input="" stored_len="zip_strstart" -="" zip_block_start;="" zip_flag_buf[zip_last_flags]="zip_flags;" save="" flags="" items="" construct="" zip_build_tree(zip_l_desc);="" "\nlit="" data:="" dyn="" %ld,="" stat="" %ld",="" encoder-="">opt_len, encoder->static_len));

    zip_build_tree(zip_d_desc);
//    Tracev((stderr, "\ndist data: dyn %ld, stat %ld",
//	    encoder->opt_len, encoder->static_len));
    /* At this point, opt_len and static_len are the total bit lengths of
     * the compressed block data, excluding the tree representations.
     */

    /* Build the bit length tree for the above two trees, and get the index
     * in bl_order of the last bit length code to send.
     */
    max_blindex = zip_build_bl_tree();

    // Determine the best encoding. Compute first the block length in bytes
    opt_lenb	= (zip_opt_len   +3+7)>>3;
    static_lenb = (zip_static_len+3+7)>>3;

//    Trace((stderr, "\nopt %lu(%lu) stat %lu(%lu) stored %lu lit %u dist %u ",
//	   opt_lenb, encoder->opt_len,
//	   static_lenb, encoder->static_len, stored_len,
//	   encoder->last_lit, encoder->last_dist));

    if(static_lenb <= 4="" opt_lenb)="" opt_lenb="static_lenb;" if(stored_len="" +="" <="opt_lenb" 4:="" two="" words="" for="" the="" lengths="" &&="" zip_block_start="">= 0) {
	var i;

	/* The test buf != NULL is only necessary if LIT_BUFSIZE > WSIZE.
	 * Otherwise we can't have processed more than WSIZE input bytes since
	 * the last block flush, because compression would have been
	 * successful. If LIT_BUFSIZE <= 1="" wsize,="" it="" is="" never="" too="" late="" to="" *="" transform="" a="" block="" into="" stored="" block.="" zip_send_bits((zip_stored_block<<1)+eof,="" 3);="" send="" type="" zip_bi_windup();="" align="" on="" byte="" boundary="" zip_put_short(stored_len);="" zip_put_short(~stored_len);="" copy="" p="&window[block_start];" for(i="0;" i="" <="" stored_len;="" i++)="" put_byte(p[i]);="" zip_put_byte(zip_window[zip_block_start="" +="" i]);="" }="" else="" if(static_lenb="=" opt_lenb)="" {="" zip_send_bits((zip_static_trees<<1)+eof,="" zip_compress_block(zip_static_ltree,="" zip_static_dtree);="" zip_send_bits((zip_dyn_trees<<1)+eof,="" zip_send_all_trees(zip_l_desc.max_code+1,="" zip_d_desc.max_code+1,="" max_blindex+1);="" zip_compress_block(zip_dyn_ltree,="" zip_dyn_dtree);="" zip_init_block();="" if(eof="" !="0)" save="" the="" match="" info="" and="" tally="" frequency="" counts.="" return="" true="" if="" current="" must="" be="" flushed.="" function="" zip_ct_tally(="" dist,="" distance="" of="" matched="" string="" lc)="" length-min_match="" or="" unmatched="" char="" (if="" dist="=0)" zip_l_buf[zip_last_lit++]="lc;" if(dist="=" 0)="" lc="" zip_dyn_ltree[lc].fc++;="" here,="" length="" -="" min_match="" dist--;="" assert((ush)dist="" (ush)max_dist="" &&="" (ush)lc="" (ush)d_code(dist)="" (ush)d_codes,="" "ct_tally:="" bad="" match");="" zip_dyn_ltree[zip_length_code[lc]+zip_literals+1].fc++;="" zip_dyn_dtree[zip_d_code(dist)].fc++;="" zip_d_buf[zip_last_dist++]="dist;" zip_flags="" |="zip_flag_bit;" zip_flag_bit="" <<="1;" output="" flags="" they="" fill="" if((zip_last_lit="" &="" 7)="=" zip_flag_buf[zip_last_flags++]="zip_flags;" try="" guess="" profitable="" stop="" here="" if(zip_compr_level=""> 2 && (zip_last_lit & 0xfff) == 0) {
	// Compute an upper bound for the compressed length
	var out_length = zip_last_lit * 8;
	var in_length = zip_strstart - zip_block_start;
	var dcode;

	for(dcode = 0; dcode < zip_D_CODES; dcode++) {
	    out_length += zip_dyn_dtree[dcode].fc * (5 + zip_extra_dbits[dcode]);
	}
	out_length >>= 3;
//      Trace((stderr,"\nlast_lit %u, last_dist %u, in %ld, out ~%ld(%ld%%) ",
//	     encoder->last_lit, encoder->last_dist, in_length, out_length,
//	     100L - out_length*100L/in_length));
	if(zip_last_dist < parseInt(zip_last_lit/2) &&
	   out_length < parseInt(in_length/2))
	    return true;
    }
    return (zip_last_lit == zip_LIT_BUFSIZE-1 ||
	    zip_last_dist == zip_DIST_BUFSIZE);
    /* We avoid equality with LIT_BUFSIZE because of wraparound at 64K
     * on 16 bit machines and because stored blocks are restricted to
     * 64K-1 bytes.
     */
}

  /* ==========================================================================
   * Send the block data compressed using the given Huffman trees
   */
function zip_compress_block(
	ltree,	// literal tree
	dtree) {	// distance tree
    var dist;		// distance of matched string
    var lc;		// match length or unmatched char (if dist == 0)
    var lx = 0;		// running index in l_buf
    var dx = 0;		// running index in d_buf
    var fx = 0;		// running index in flag_buf
    var flag = 0;	// current flags
    var code;		// the code to send
    var extra;		// number of extra bits to send

    if(zip_last_lit != 0) do {
	if((lx & 7) == 0)
	    flag = zip_flag_buf[fx++];
	lc = zip_l_buf[lx++] & 0xff;
	if((flag & 1) == 0) {
	    zip_SEND_CODE(lc, ltree); /* send a literal byte */
//	Tracecv(isgraph(lc), (stderr," '%c' ", lc));
	} else {
	    // Here, lc is the match length - MIN_MATCH
	    code = zip_length_code[lc];
	    zip_SEND_CODE(code+zip_LITERALS+1, ltree); // send the length code
	    extra = zip_extra_lbits[code];
	    if(extra != 0) {
		lc -= zip_base_length[code];
		zip_send_bits(lc, extra); // send the extra length bits
	    }
	    dist = zip_d_buf[dx++];
	    // Here, dist is the match distance - 1
	    code = zip_D_CODE(dist);
//	Assert (code < D_CODES, "bad d_code");

	    zip_SEND_CODE(code, dtree);	  // send the distance code
	    extra = zip_extra_dbits[code];
	    if(extra != 0) {
		dist -= zip_base_dist[code];
		zip_send_bits(dist, extra);   // send the extra distance bits
	    }
	} // literal or match pair ?
	flag >>= 1;
    } while(lx < zip_last_lit);

    zip_SEND_CODE(zip_END_BLOCK, ltree);
}

/* ==========================================================================
 * Send a value on a given number of bits.
 * IN assertion: length <= 16="" and="" value="" fits="" in="" length="" bits.="" *="" var="" zip_buf_size="16;" bit="" size="" of="" bi_buf="" function="" zip_send_bits(="" value,="" to="" send="" length)="" {="" number="" bits="" if="" not="" enough="" room="" bi_buf,="" use="" (valid)="" from="" (16="" -="" bi_valid)="" leaving="" (width="" (16-bi_valid))="" unused="" value.="" if(zip_bi_valid=""> zip_Buf_size - length) {
	zip_bi_buf |= (value << zip_bi_valid);
	zip_put_short(zip_bi_buf);
	zip_bi_buf = (value >> (zip_Buf_size - zip_bi_valid));
	zip_bi_valid += length - zip_Buf_size;
    } else {
	zip_bi_buf |= value << zip_bi_valid;
	zip_bi_valid += length;
    }
}

/* ==========================================================================
 * Reverse the first len bits of a code, using straightforward code (a faster
 * method would use a table)
 * IN assertion: 1 <= len="" <="15" *="" function="" zip_bi_reverse(="" code,="" the="" value="" to="" invert="" len)="" {="" its="" bit="" length="" var="" res="0;" do="" |="code" &="" 1;="" code="">>= 1;
	res <<= 1;="" }="" while(--len=""> 0);
    return res >> 1;
}

/* ==========================================================================
 * Write out any remaining bits in an incomplete byte.
 */
function zip_bi_windup() {
    if(zip_bi_valid > 8) {
	zip_put_short(zip_bi_buf);
    } else if(zip_bi_valid > 0) {
	zip_put_byte(zip_bi_buf);
    }
    zip_bi_buf = 0;
    zip_bi_valid = 0;
}

function zip_qoutbuf() {
    if(zip_outcnt != 0) {
	var q, i;
	q = zip_new_queue();
	if(zip_qhead == null)
	    zip_qhead = zip_qtail = q;
	else
	    zip_qtail = zip_qtail.next = q;
	q.len = zip_outcnt - zip_outoff;
//      System.arraycopy(zip_outbuf, zip_outoff, q.ptr, 0, q.len);
	for(i = 0; i < q.len; i++)
	    q.ptr[i] = zip_outbuf[zip_outoff + i];
	zip_outcnt = zip_outoff = 0;
    }
}

return function deflate(str, level) {
    var i, j;

    zip_deflate_data = str;
    zip_deflate_pos = 0;
    if(typeof level == "undefined")
	level = zip_DEFAULT_LEVEL;
    zip_deflate_start(level);

    var buff = new Array(1024);
    var aout = [];
    while((i = zip_deflate_internal(buff, 0, buff.length)) > 0) {
	var cbuf = new Array(i);
	for(j = 0; j < i; j++){
	    cbuf[j] = String.fromCharCode(buff[j]);
	}
	aout[aout.length] = cbuf.join("");
    }
    zip_deflate_data = null; // G.C.
    return aout.join("");
};

})();

onmessage = function worker(m) {
  postMessage(deflate(m.data, 9));
};

onconnect = function sharedWorker(e) {
  var port = e.ports[0];
  port.onmessage = function(m) {
    port.postMessage(deflate(m.data, 9));
  };
};
</=></=></=></=></=></=></=></=></max_bits)-1,></=></(zip_extra_dbits[code]-7));></zip_extra_dbits[code]);></zip_extra_lbits[code]);></=></=></=></=></=></=></zip_bits))></1)></iz@onicos.co.jp>